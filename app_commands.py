"""discord.app_commands subset (slash commands) for the PyPad simulator."""
import inspect, shlex, sys, traceback
import discord


class AppCommandError(discord.DiscordException):
    pass


class Choice:
    def __init__(self, *, name, value):
        self.name, self.value = name, value


class Command:
    def __init__(self, callback, name, description):
        self.callback, self.name, self.description = callback, name, description or "No description"
        self.binding = None


def command(*, name=None, description=None, **kw):
    def deco(f):
        return Command(f, name or f.__name__.replace("_", "-"), description or f.__doc__)
    return deco


def describe(**kw):
    return lambda f: f


def choices(**kw):
    return lambda f: f


def rename(**kw):
    return lambda f: f


def guild_only(f=None):
    return f if f else (lambda x: x)


def checks_noop(*a, **k):
    return lambda f: f


class CommandTree:
    def __init__(self, client, **kw):
        self.client, self.commands = client, {}
        client._tree = self

    def command(self, *, name=None, description=None, **kw):
        def deco(f):
            c = Command(f, name or f.__name__, description or f.__doc__)
            self.commands[c.name] = c
            return c
        return deco

    def add_command(self, cmd, **kw):
        self.commands[cmd.name] = cmd

    def remove_command(self, name, **kw):
        return self.commands.pop(name, None)

    def get_commands(self, **kw):
        return list(self.commands.values())

    def copy_global_to(self, **kw):
        pass

    def error(self, f):
        self._on_error = f
        return f

    async def sync(self, *, guild=None):
        discord._emit({"type": "sys", "text": "Synced %d slash command(s): %s" % (len(self.commands), ", ".join("/" + n for n in self.commands))})
        return list(self.commands.values())

    async def _simulate(self, text, user, channel):
        try:
            parts = shlex.split(text)
        except ValueError:
            parts = text.split()
        if not parts or parts[0] not in self.commands:
            if parts and parts[0]:
                discord._emit({"type": "sys", "text": "Unknown slash command /%s (available: %s)" % (parts[0], ", ".join("/" + n for n in self.commands) or "none")})
                return True
            return False
        cmd = self.commands[parts[0]]
        sig = list(inspect.signature(cmd.callback).parameters.values())
        skip = 2 if cmd.binding is not None else 1
        # (self?, interaction, *options)
        opts = sig[skip:] if len(sig) >= skip else []
        values, params, rest = [], {}, parts[1:]
        try:
            for p in opts:
                if rest:
                    v = discord._convert(rest.pop(0), p.annotation, self.client, channel.guild)
                elif p.default is not inspect.Parameter.empty:
                    v = p.default
                else:
                    raise discord._ConvertError("Missing required option '%s'" % p.name)
                params[p.name] = v
        except discord._ConvertError as e:
            discord._emit({"type": "sys", "text": "Invalid option: %s" % e})
            return True
        inter = discord.Interaction(self.client, user, channel, cmd, params)
        discord._emit({"type": "sys", "text": "%s used /%s" % (user.name, cmd.name)})
        args = ([cmd.binding] if cmd.binding is not None else []) + [inter]
        try:
            await cmd.callback(*args, **params)
        except Exception as e:
            h = getattr(self, "_on_error", None)
            if h:
                await h(inter, AppCommandError(str(e)))
            else:
                sys.stderr.write("Ignoring exception in slash command /%s\n%s" % (cmd.name, discord._clean_tb()))
        return True
