"""discord.ext.commands for the PyPad Discord simulator."""
import asyncio, inspect, sys, types, importlib, traceback, copy
import discord
from discord import Client, Intents, Embed, _convert, _ConvertError, _spawn, _clean_tb
from discord.app_commands import CommandTree


# ───────────── errors ─────────────
class CommandError(discord.DiscordException):
    def __init__(self, message=None, *args):
        super().__init__(message or "Command error")


class UserInputError(CommandError):
    pass


class CommandNotFound(CommandError):
    pass


class MissingRequiredArgument(UserInputError):
    def __init__(self, param):
        self.param = param
        super().__init__("%s is a required argument that is missing." % param.name)


class BadArgument(UserInputError):
    pass


class TooManyArguments(UserInputError):
    pass


class CheckFailure(CommandError):
    pass


class NotOwner(CheckFailure):
    pass


class MissingPermissions(CheckFailure):
    pass


class MissingRole(CheckFailure):
    pass


class CommandOnCooldown(CommandError):
    pass


class CommandInvokeError(CommandError):
    def __init__(self, e):
        self.original = e
        super().__init__("Command raised an exception: %s: %s" % (type(e).__name__, e))


class ExtensionNotFound(CommandError):
    pass


# ───────────── parsing ─────────────
class _View:
    def __init__(self, text):
        self.text, self.i = text, 0

    def skip_ws(self):
        while self.i < len(self.text) and self.text[self.i].isspace():
            self.i += 1

    def word(self):
        self.skip_ws()
        if self.i >= len(self.text):
            return None
        t = self.text
        if t[self.i] in "\"\u201c":
            close = {"\"": "\"", "\u201c": "\u201d"}[t[self.i]]
            j = t.find(close, self.i + 1)
            if j != -1:
                w = t[self.i + 1:j]
                self.i = j + 1
                return w
        j = self.i
        while j < len(t) and not t[j].isspace():
            j += 1
        w = t[self.i:j]
        self.i = j
        return w

    def peek(self):
        i = self.i
        w = self.word()
        self.i = i
        return w

    def rest(self):
        self.skip_ws()
        r = self.text[self.i:]
        self.i = len(self.text)
        return r


# ───────────── Context ─────────────
class Context:
    def __init__(self, message, bot, prefix=None, command=None, invoked_with=None, view=None):
        self.message, self.bot, self.prefix, self.command, self.invoked_with = message, bot, prefix, command, invoked_with
        self.view = view
        self.author, self.channel, self.guild, self.me = message.author, message.channel, message.guild, bot.user
        self.args, self.kwargs, self.interaction = [], {}, None
        self.cog = getattr(command, "cog", None)

    valid = property(lambda s: s.command is not None)
    clean_prefix = property(lambda s: s.prefix or "")

    async def send(self, content=None, **kw):
        return await self.channel.send(content, **kw)

    async def reply(self, content=None, **kw):
        return await self.message.reply(content, **kw)

    def typing(self):
        return self.channel.typing()

    async def send_help(self, target=None):
        await self.bot._help(self, target)

    async def invoke(self, command, *args, **kwargs):
        return await command.callback(self, *args, **kwargs)


# ───────────── Command / Group ─────────────
class Command:
    def __init__(self, func, name=None, aliases=(), help=None, brief=None, description=None, usage=None, hidden=False,
                 enabled=True, rest_is_raw=False, **kw):
        self.callback = func
        self.name = name or func.__name__
        self.aliases = list(aliases)
        self.help = help if help is not None else inspect.getdoc(func)
        self.brief, self.description, self.usage, self.hidden, self.enabled = brief, description or "", usage, hidden, enabled
        self.cog, self.parent = None, None
        self.checks = list(getattr(func, "__commands_checks__", []))
        self.cooldown = None
        self._error = None

    qualified_name = property(lambda s: (s.parent.qualified_name + " " if s.parent else "") + s.name)

    @property
    def signature(self):
        if self.usage:
            return self.usage
        out = []
        for p in list(inspect.signature(self.callback).parameters.values())[1:]:
            if p.kind == p.VAR_POSITIONAL:
                out.append("[%s...]" % p.name)
            elif p.default is p.empty:
                out.append("<%s>" % p.name)
            else:
                out.append("[%s=%s]" % (p.name, p.default) if p.default not in (None, "") else "[%s]" % p.name)
        return " ".join(out)

    def error(self, f):
        self._error = f
        return f

    def before_invoke(self, f):
        return f

    after_invoke = before_invoke

    def __call__(self, *a, **k):
        return self.callback(*a, **k)

    async def _parse(self, ctx):
        params = list(inspect.signature(self.callback).parameters.values())[1:]
        args, kwargs, view = [], {}, ctx.view
        for p in params:
            ann = p.annotation
            try:
                if p.kind == p.VAR_POSITIONAL:
                    while True:
                        w = view.word()
                        if w is None:
                            break
                        args.append(_convert(w, ann, ctx.bot, ctx.guild))
                elif p.kind == p.KEYWORD_ONLY:
                    w = view.rest()
                    if not w:
                        if p.default is p.empty:
                            raise MissingRequiredArgument(p)
                        kwargs[p.name] = p.default
                    else:
                        kwargs[p.name] = _convert(w, ann, ctx.bot, ctx.guild)
                elif p.kind in (p.POSITIONAL_OR_KEYWORD, p.POSITIONAL_ONLY):
                    w = view.word()
                    if w is None:
                        if p.default is p.empty:
                            raise MissingRequiredArgument(p)
                        args.append(p.default)
                    else:
                        args.append(_convert(w, ann, ctx.bot, ctx.guild))
            except _ConvertError as e:
                raise BadArgument(str(e))
        return args, kwargs

    async def invoke(self, ctx):
        args, kwargs = await self._parse(ctx)
        ctx.args, ctx.kwargs = [ctx] + args, kwargs
        await self.callback(ctx, *args, **kwargs)


class Group(Command):
    def __init__(self, func, invoke_without_command=False, **kw):
        super().__init__(func, **kw)
        self.invoke_without_command = invoke_without_command
        self.all_commands = {}

    commands = property(lambda s: set(s.all_commands.values()))

    def add_command(self, cmd):
        cmd.parent = self
        self.all_commands[cmd.name] = cmd
        for a in cmd.aliases:
            self.all_commands[a] = cmd

    def command(self, *a, **k):
        def deco(f):
            c = Command(f, *a, **k)
            self.add_command(c)
            return c
        return deco

    def group(self, *a, **k):
        def deco(f):
            c = Group(f, *a, **k)
            self.add_command(c)
            return c
        return deco

    def get_command(self, name):
        return self.all_commands.get(name)


def command(name=None, cls=None, **attrs):
    return lambda f: (cls or Command)(f, name=name, **attrs)


def group(name=None, **attrs):
    return lambda f: Group(f, name=name, **attrs)


hybrid_command = command
hybrid_group = group


# ───────────── checks ─────────────
def check(predicate):
    def deco(f):
        if isinstance(f, Command):
            f.checks.append(predicate)
        else:
            f.__commands_checks__ = getattr(f, "__commands_checks__", []) + [predicate]
        return f
    return deco


def _always(*a, **k):
    return check(lambda ctx: True)


has_permissions = has_guild_permissions = bot_has_permissions = has_role = has_any_role = guild_only = dm_only = cooldown = max_concurrency = _always


def is_owner():
    return check(lambda ctx: True)


def is_nsfw():
    return check(lambda ctx: True)


# ───────────── Cog ─────────────
class Cog:
    @classmethod
    def listener(cls, name=None):
        def deco(f):
            f.__cog_listener__ = name or f.__name__
            return f
        return deco

    @property
    def qualified_name(self):
        return type(self).__name__

    def get_commands(self):
        return [c for c in getattr(self, "__cog_commands__", [])]

    async def cog_load(self):
        pass

    async def cog_unload(self):
        pass


class _Done:
    def __await__(self):
        return iter(())


# ───────────── Bot ─────────────
class Bot(Client):
    def __init__(self, command_prefix="!", *, help_command=..., description=None, intents=None, case_insensitive=False, owner_id=None, **options):
        super().__init__(intents=intents, **options)
        self.command_prefix, self.description, self.case_insensitive = command_prefix, description, case_insensitive
        self.all_commands, self.cogs, self.extensions, self._checks = {}, {}, {}, []
        self.tree = CommandTree(self)
        self.owner_id = owner_id
        if help_command is not None:
            self.add_command(Command(self._help_cmd, name="help", help="Shows this message", hidden=False))

    commands = property(lambda s: set(s.all_commands.values()))
    help_command = None

    async def _help_cmd(self, ctx, *, command: str = None):
        await self._help(ctx, command)

    async def _help(self, ctx, target):
        p = self.command_prefix if isinstance(self.command_prefix, str) else (list(self.command_prefix) or ["!"])[0]
        if target:
            c = self.get_command(target)
            if c is None:
                return await ctx.send('No command called "%s" found.' % target)
            e = Embed(title="%s%s %s" % (p, c.qualified_name, c.signature), description=c.help or "No description", color=discord.Color.blurple())
            return await ctx.send(embed=e)
        lines = ["**%s%s** — %s" % (p, c.name, (c.brief or c.help or "").split("\n")[0]) for c in sorted(self.commands, key=lambda c: c.name) if not c.hidden]
        await ctx.send(embed=Embed(title="Commands", description="\n".join(lines) or "No commands", color=discord.Color.blurple()))

    # command management
    def add_command(self, cmd):
        self.all_commands[cmd.name] = cmd
        for a in cmd.aliases:
            self.all_commands[a] = cmd

    def remove_command(self, name):
        c = self.all_commands.pop(name, None)
        if c:
            for a in c.aliases:
                self.all_commands.pop(a, None)
        return c

    def get_command(self, name):
        parts = name.split()
        c = self._lookup(parts[0])
        for p in parts[1:]:
            if isinstance(c, Group):
                c = c.get_command(p)
            else:
                return None
        return c

    def _lookup(self, name):
        if name is None:
            return None
        c = self.all_commands.get(name)
        if c is None and self.case_insensitive:
            c = self.all_commands.get(name.lower())
        return c

    def command(self, name=None, **attrs):
        def deco(f):
            c = Command(f, name=name, **attrs)
            self.add_command(c)
            return c
        return deco

    def group(self, name=None, **attrs):
        def deco(f):
            c = Group(f, name=name, **attrs)
            self.add_command(c)
            return c
        return deco

    def check(self, f):
        self._checks.append(f)
        return f

    # cogs / extensions
    def add_cog(self, cog, *, override=False, **kw):
        cmds = []
        for n in dir(type(cog)):
            attr = getattr(type(cog), n, None)
            if isinstance(attr, Command):
                c = copy.copy(attr)
                c.cog = cog
                c.callback = types.MethodType(attr.callback, cog)
                if isinstance(c, Group):
                    c.all_commands = {k: v for k, v in attr.all_commands.items()}
                    for sub in set(c.all_commands.values()):
                        sub.cog = cog
                        sub.callback = types.MethodType(sub.callback.__func__ if hasattr(sub.callback, "__func__") else sub.callback, cog)
                self.add_command(c)
                cmds.append(c)
            elif isinstance(attr, __import__("discord.app_commands", fromlist=["x"]).Command):
                attr.binding = cog
                self.tree.add_command(attr)
        for n in dir(cog):
            f = getattr(cog, n, None)
            if callable(f) and getattr(f, "__cog_listener__", None):
                self.add_listener(f, f.__cog_listener__)
        cog.__cog_commands__ = cmds
        self.cogs[type(cog).__name__] = cog
        _spawn(cog.cog_load())
        return _Done()

    def get_cog(self, name):
        return self.cogs.get(name)

    def remove_cog(self, name):
        cog = self.cogs.pop(name, None)
        if cog:
            for c in getattr(cog, "__cog_commands__", []):
                self.remove_command(c.name)
        return _Done()

    async def load_extension(self, name, *, package=None):
        try:
            mod = importlib.import_module(name)
        except ModuleNotFoundError as e:
            raise ExtensionNotFound(str(e))
        r = mod.setup(self)
        if inspect.isawaitable(r):
            await r
        self.extensions[name] = mod

    async def unload_extension(self, name, **kw):
        self.extensions.pop(name, None)

    async def reload_extension(self, name, **kw):
        sys.modules.pop(name, None)
        await self.load_extension(name)

    # dispatching
    async def get_prefix(self, message):
        p = self.command_prefix
        if callable(p):
            p = p(self, message)
            if inspect.isawaitable(p):
                p = await p
        return p

    async def get_context(self, message, *, cls=Context):
        view = _View(message.content)
        ctx = cls(message, self, view=view)
        prefixes = await self.get_prefix(message)
        prefixes = [prefixes] if isinstance(prefixes, str) else list(prefixes)
        prefixes += ["<@%d> " % self.user.id, "<@!%d> " % self.user.id]
        used = next((p for p in sorted(prefixes, key=len, reverse=True) if p and message.content.startswith(p)), None)
        if used is None:
            return ctx
        view.i = len(used)
        ctx.prefix = used
        word = view.word()
        cmd = self._lookup(word)
        invoked = word
        while isinstance(cmd, Group):
            nxt = view.peek()
            sub = cmd.get_command(nxt) if nxt else None
            if sub is None:
                break
            view.word()
            cmd, invoked = sub, invoked + " " + nxt
        ctx.command, ctx.invoked_with, ctx.cog = cmd, invoked, getattr(cmd, "cog", None)
        if cmd is None and word is not None:
            ctx.invoked_with = word
        return ctx

    async def process_commands(self, message):
        if message.author.bot:
            return
        ctx = await self.get_context(message)
        if ctx.prefix is None:
            return
        await self.invoke(ctx)

    async def invoke(self, ctx):
        if ctx.command is None:
            if ctx.invoked_with:
                self.dispatch("command_error", ctx, CommandNotFound('Command "%s" is not found' % ctx.invoked_with))
            return
        try:
            for chk in self._checks + ctx.command.checks:
                r = chk(ctx)
                if inspect.isawaitable(r):
                    r = await r
                if not r:
                    raise CheckFailure("The check functions for command %s failed." % ctx.command.name)
            self.dispatch("command", ctx)
            await ctx.command.invoke(ctx)
            self.dispatch("command_completion", ctx)
        except CommandError as e:
            self._error(ctx, e)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa
            sys.stderr.write("Ignoring exception in command %s:\n%s" % (ctx.command.name, _clean_tb()))
            self._error(ctx, CommandInvokeError(e), logged=True)

    def _error(self, ctx, err, logged=False):
        cmd = ctx.command
        if cmd is not None and cmd._error is not None:
            _spawn(cmd._error(ctx, err))
            return
        if getattr(self, "on_command_error", None) is not None or self._listeners.get("command_error"):
            self.dispatch("command_error", ctx, err)
        elif not logged:
            print("[discord] %s: %s" % (type(err).__name__, err), file=sys.stderr)

    async def on_message(self, message):
        await self.process_commands(message)


AutoShardedBot = Bot
