"""discord.py-compatible API for PyPad.

IMPORTANT: this runs against PyPad's built-in *simulator* (the Discord tab). iOS apps can't open the
raw gateway connection discord.py needs, so ``bot.run(token)`` never contacts Discord. Your bot code
(commands, cogs, embeds, events, tasks, slash commands) is written exactly as for discord.py, so the
same file can be deployed unchanged to a server with the real library.
"""
import asyncio, itertools, json, sys, traceback, datetime, enum, re, shlex, inspect, typing

try:
    import js
except ImportError:
    js = None

__version__ = "2.4.0-pypad-sim"

_ids = itertools.count(1100000000000000001)
_client = None
_tasks = set()
_log = []  # (channel, Message)


def _emit(obj):
    if js is not None:
        js.PyPad.discordMsg(json.dumps(obj, default=str))


def _reset():
    global _client
    for t in list(_tasks):
        t.cancel()
    _tasks.clear()
    _log.clear()
    _client = None


def _spawn(coro):
    t = asyncio.ensure_future(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)
    return t


# ───────────── errors ─────────────
class DiscordException(Exception):
    pass


class ClientException(DiscordException):
    pass


class HTTPException(DiscordException):
    pass


class Forbidden(HTTPException):
    pass


class NotFound(HTTPException):
    pass


class LoginFailure(ClientException):
    pass


# ───────────── small value types ─────────────
class Colour:
    def __init__(self, value=0):
        self.value = int(value)

    @classmethod
    def from_rgb(cls, r, g, b):
        return cls((r << 16) + (g << 8) + b)

    @classmethod
    def from_str(cls, s):
        return cls(int(s.lstrip("#"), 16))

    def __int__(self):
        return self.value

    def __eq__(self, o):
        return int(o) == self.value

    def __repr__(self):
        return "<Colour value=%d>" % self.value

    def __str__(self):
        return "#%06x" % self.value


for _n, _v in dict(default=0, teal=0x1ABC9C, dark_teal=0x11806A, green=0x2ECC71, dark_green=0x1F8B4C, blue=0x3498DB,
                   dark_blue=0x206694, purple=0x9B59B6, dark_purple=0x71368A, magenta=0xE91E63, dark_magenta=0xAD1457,
                   gold=0xF1C40F, dark_gold=0xC27C0E, orange=0xE67E22, dark_orange=0xA84300, red=0xE74C3C,
                   dark_red=0x992D22, lighter_grey=0x95A5A6, dark_grey=0x607D8B, blurple=0x5865F2, greyple=0x99AAB5,
                   og_blurple=0x7289DA, yellow=0xFEE75C, fuchsia=0xEB459E, pink=0xEB459E, white=0xFFFFFF, black=0).items():
    setattr(Colour, _n, classmethod(lambda cls, _v=_v: cls(_v)))
Colour.random = classmethod(lambda cls: cls(__import__("random").randint(0, 0xFFFFFF)))
Color = Colour


class _Flags:
    _names = ()

    def __init__(self, **kw):
        for n in self._names:
            setattr(self, n, False)
        for k, v in kw.items():
            setattr(self, k, v)

    @classmethod
    def all(cls):
        return cls(**{n: True for n in cls._names})

    @classmethod
    def none(cls):
        return cls()


class Intents(_Flags):
    _names = ("guilds", "members", "moderation", "emojis", "integrations", "webhooks", "invites", "voice_states", "presences",
              "messages", "guild_messages", "dm_messages", "reactions", "typing", "message_content", "guild_scheduled_events")

    @classmethod
    def default(cls):
        i = cls(**{n: True for n in cls._names})
        i.members = i.presences = i.message_content = False
        return i


class Permissions(_Flags):
    _names = ("administrator", "manage_messages", "manage_guild", "kick_members", "ban_members", "send_messages", "read_messages",
              "manage_channels", "manage_roles", "mention_everyone", "view_channel")


class Embed:
    Empty = None

    def __init__(self, *, colour=None, color=None, title=None, type="rich", url=None, description=None, timestamp=None):
        self.colour = colour if colour is not None else color
        self.title, self.url, self.description, self.timestamp, self.type = title, url, description, timestamp, type
        self.fields, self.footer_, self.author_, self.thumb, self.image_ = [], None, None, None, None

    color = property(lambda s: s.colour, lambda s, v: setattr(s, "colour", v))

    def add_field(self, *, name, value, inline=True):
        self.fields.append({"name": str(name), "value": str(value), "inline": inline})
        return self

    def insert_field_at(self, index, *, name, value, inline=True):
        self.fields.insert(index, {"name": str(name), "value": str(value), "inline": inline})
        return self

    def clear_fields(self):
        self.fields.clear()
        return self

    def set_footer(self, *, text=None, icon_url=None):
        self.footer_ = {"text": text}
        return self

    def set_author(self, *, name, url=None, icon_url=None):
        self.author_ = {"name": name}
        return self

    def set_thumbnail(self, *, url):
        self.thumb = url
        return self

    def set_image(self, *, url):
        self.image_ = url
        return self

    def to_dict(self):
        return {"title": self.title, "description": self.description, "url": self.url,
                "color": ("#%06x" % int(self.colour)) if self.colour is not None else None, "fields": self.fields,
                "footer": self.footer_, "author": self.author_, "thumbnail": self.thumb, "image": self.image_}

    def copy(self):
        import copy
        return copy.deepcopy(self)


class File:
    def __init__(self, fp, filename=None, **kw):
        self.fp, self.filename = fp, filename or getattr(fp, "name", "file")


class Object:
    def __init__(self, id):
        self.id = int(id)


class ActivityType(enum.IntEnum):
    playing = 0
    streaming = 1
    listening = 2
    watching = 3
    competing = 5


class Status(enum.Enum):
    online = "online"
    offline = "offline"
    idle = "idle"
    dnd = "dnd"
    invisible = "invisible"


class Activity:
    def __init__(self, *, name=None, type=ActivityType.playing, **kw):
        self.name, self.type = name, type


class Game(Activity):
    def __init__(self, name, **kw):
        super().__init__(name=name)


# ───────────── models ─────────────
class User:
    def __init__(self, id, name, bot=False):
        self.id, self.name, self.bot = id, name, bot
        self.display_name = self.global_name = name
        self.discriminator = "0"
        self.guild_permissions = Permissions.all()
        self.roles = []
        self.avatar = None
        self.guild = None

    mention = property(lambda s: "<@%d>" % s.id)
    created_at = property(lambda s: datetime.datetime.now(datetime.timezone.utc))
    display_avatar = property(lambda s: type("Asset", (), {"url": "https://cdn.discordapp.com/embed/avatars/0.png"})())

    def __str__(self):
        return self.name

    def __eq__(self, o):
        return getattr(o, "id", None) == self.id

    def __hash__(self):
        return hash(self.id)

    def __repr__(self):
        return "<%s id=%d name=%r bot=%s>" % (type(self).__name__, self.id, self.name, self.bot)

    async def send(self, content=None, **kw):
        ch = _client._guild.channels[0]
        return await ch.send(content, **kw)


Member = User
ClientUser = User


class Guild:
    def __init__(self, name):
        self.id, self.name = next(_ids), name
        self.channels, self.members, self.text_channels = [], [], []
        self.owner_id = None
        self.roles = []

    member_count = property(lambda s: len(s.members))

    def get_channel(self, id):
        return next((c for c in self.channels if c.id == id), None)

    def get_member(self, id):
        return next((m for m in self.members if m.id == id), None)

    def get_member_named(self, name):
        return next((m for m in self.members if m.name.lower() == name.lower()), None)


class _Typing:
    def __init__(self, ch):
        self.ch = ch

    async def __aenter__(self):
        _emit({"type": "typing", "channel": self.ch.name})

    async def __aexit__(self, *a):
        return False

    def __await__(self):
        return self.__aenter__().__await__()


class TextChannel:
    def __init__(self, guild, name):
        self.id, self.guild, self.name = next(_ids), guild, name
        self.topic = None

    mention = property(lambda s: "<#%d>" % s.id)

    def __str__(self):
        return self.name

    def typing(self):
        return _Typing(self)

    async def send(self, content=None, *, tts=False, embed=None, embeds=None, file=None, files=None, delete_after=None,
                   reference=None, mention_author=None, view=None, allowed_mentions=None, ephemeral=False, **kw):
        embs = list(embeds or ([embed] if embed else []))
        if content is None and not embs and not file and not files:
            raise HTTPException("400 Bad Request (error code: 50006): Cannot send an empty message")
        m = Message(self, _client.user, "" if content is None else str(content), embs)
        if file or files:
            m.attachments = [f.filename for f in ([file] if file else files)]
        if reference is not None:
            m.reference = reference
        _log.append(m)
        _emit(m._payload(ephemeral=ephemeral))
        if delete_after:
            async def later():
                await asyncio.sleep(delete_after)
                await m.delete()
            _spawn(later())
        return m

    async def history(self, limit=100, **kw):
        for m in [x for x in _log if x.channel is self][-limit:][::-1]:
            yield m

    async def purge(self, limit=100, **kw):
        ms = [x for x in _log if x.channel is self][-limit:]
        for m in ms:
            await m.delete()
        return ms

    async def fetch_message(self, id):
        for m in _log:
            if m.id == id:
                return m
        raise NotFound("Unknown Message")


class Message:
    def __init__(self, channel, author, content, embeds=()):
        self.id, self.channel, self.author, self.content = next(_ids), channel, author, content
        self.guild = channel.guild
        self.embeds = list(embeds)
        self.attachments, self.reactions, self.reference = [], [], None
        self.created_at = datetime.datetime.now(datetime.timezone.utc)
        self.edited_at = None
        self.mentions = [m for m in (self.guild.members if self.guild else []) if ("<@%d>" % m.id) in content or ("<@!%d>" % m.id) in content]
        self.mention_everyone = "@everyone" in content
        self.pinned = False
        self.webhook_id = None

    clean_content = property(lambda s: re.sub(r"<@!?(\d+)>", lambda m: "@" + next((u.name for u in s.guild.members if u.id == int(m.group(1))), "unknown"), s.content))
    jump_url = property(lambda s: "https://discord.com/channels/%d/%d/%d" % (s.guild.id, s.channel.id, s.id))

    def _payload(self, ephemeral=False):
        return {"type": "message", "id": self.id, "channel": self.channel.name,
                "author": {"id": self.author.id, "name": self.author.name, "bot": self.author.bot},
                "content": self.content, "embeds": [e.to_dict() for e in self.embeds],
                "reply": getattr(self.reference, "id", None) if self.reference is not None else None, "ephemeral": ephemeral,
                "files": self.attachments}

    async def reply(self, content=None, **kw):
        kw["reference"] = self
        return await self.channel.send(content, **kw)

    async def edit(self, *, content=None, embed=None, embeds=None, **kw):
        if content is not None:
            self.content = str(content)
        if embed is not None:
            self.embeds = [embed]
        if embeds is not None:
            self.embeds = list(embeds)
        self.edited_at = datetime.datetime.now(datetime.timezone.utc)
        _emit({"type": "edit", "id": self.id, "content": self.content, "embeds": [e.to_dict() for e in self.embeds]})
        return self

    async def delete(self, *, delay=None):
        if delay:
            await asyncio.sleep(delay)
        if self in _log:
            _log.remove(self)
        _emit({"type": "delete", "id": self.id})

    async def add_reaction(self, emoji):
        self.reactions.append(str(emoji))
        _emit({"type": "reaction", "id": self.id, "emoji": str(emoji)})

    async def pin(self, **kw):
        self.pinned = True

    async def clear_reactions(self):
        self.reactions.clear()

    def __repr__(self):
        return "<Message id=%d author=%r content=%r>" % (self.id, self.author.name, self.content)


class _Response:
    def __init__(self, inter):
        self.i, self.done = inter, False

    def is_done(self):
        return self.done

    async def send_message(self, content=None, *, embed=None, embeds=None, ephemeral=False, **kw):
        self.done = True
        self.i._last = await self.i.channel.send(content, embed=embed, embeds=embeds, ephemeral=ephemeral)

    async def defer(self, *, ephemeral=False, thinking=False):
        self.done = True
        _emit({"type": "typing", "channel": self.i.channel.name})

    async def edit_message(self, **kw):
        if self.i._last:
            await self.i._last.edit(**kw)


class _Followup:
    def __init__(self, inter):
        self.i = inter

    async def send(self, content=None, **kw):
        return await self.i.channel.send(content, **kw)


class Interaction:
    def __init__(self, client, user, channel, command, params):
        self.client, self.user, self.author, self.channel = client, user, user, channel
        self.guild, self.command, self.data = channel.guild, command, {"name": command.name, "options": params}
        self.response, self.followup, self._last = _Response(self), _Followup(self), None
        self.namespace = type("NS", (), params)()
        self.id = next(_ids)

    async def original_response(self):
        return self._last

    async def edit_original_response(self, **kw):
        if self._last:
            await self._last.edit(**kw)

    async def delete_original_response(self):
        if self._last:
            await self._last.delete()


# ───────────── argument conversion (shared by commands + slash) ─────────────
class _ConvertError(Exception):
    pass


def _convert(value, ann, client, guild):
    if ann is inspect.Parameter.empty or ann is str or ann is typing.Any:
        return value
    origin = typing.get_origin(ann)
    if origin is typing.Union:
        for a in typing.get_args(ann):
            if a is type(None):
                continue
            try:
                return _convert(value, a, client, guild)
            except _ConvertError:
                pass
        raise _ConvertError(value)
    try:
        if ann is int:
            return int(value)
        if ann is float:
            return float(value)
        if ann is bool:
            v = value.lower()
            if v in ("yes", "y", "true", "t", "1", "on", "enable"):
                return True
            if v in ("no", "n", "false", "f", "0", "off", "disable"):
                return False
            raise ValueError
    except ValueError:
        raise _ConvertError('Converting to "%s" failed' % getattr(ann, "__name__", ann))
    if ann in (User, Member):
        m = re.match(r"<@!?(\d+)>$", value)
        u = guild.get_member(int(m.group(1))) if m else (guild.get_member(int(value)) if value.isdigit() else guild.get_member_named(value))
        if u is None:
            raise _ConvertError('Member "%s" not found.' % value)
        return u
    if ann is TextChannel:
        m = re.match(r"<#(\d+)>$", value)
        c = next((c for c in guild.channels if (m and c.id == int(m.group(1))) or c.name == value.lstrip("#")), None)
        if c is None:
            raise _ConvertError('Channel "%s" not found.' % value)
        return c
    if callable(ann):
        try:
            return ann(value)
        except Exception:
            raise _ConvertError(value)
    return value


# ───────────── Client ─────────────
class Client:
    def __init__(self, *, intents=None, **options):
        self.intents = intents or Intents.default()
        self.user, self.guilds, self.activity = None, [], None
        self.latency = 0.042
        self._ready = asyncio.Event()
        self._listeners, self._waiters, self._closed = {}, [], False
        self._tree = None
        self.loop = asyncio.get_event_loop()

    users = property(lambda s: [m for g in s.guilds for m in g.members])
    emojis = stickers = property(lambda s: [])
    application_id = 0

    def event(self, coro):
        if not inspect.iscoroutinefunction(coro):
            raise TypeError("event registered must be a coroutine function")
        setattr(self, coro.__name__, coro)
        return coro

    def listen(self, name=None):
        def deco(f):
            self.add_listener(f, name)
            return f
        return deco

    def add_listener(self, func, name=None):
        self._listeners.setdefault((name or func.__name__).replace("on_", "", 1), []).append(func)

    def remove_listener(self, func, name=None):
        l = self._listeners.get((name or func.__name__).replace("on_", "", 1), [])
        if func in l:
            l.remove(func)

    def dispatch(self, event, *args):
        h = getattr(self, "on_" + event, None)
        if h is not None:
            _spawn(self._run_event(h, event, *args))
        for f in list(self._listeners.get(event, [])):
            _spawn(self._run_event(f, event, *args))
        for w in list(self._waiters):
            ev, check, fut = w
            if ev == event and not fut.done():
                try:
                    if check is None or check(*args):
                        fut.set_result(args[0] if len(args) == 1 else args)
                        self._waiters.remove(w)
                except Exception as e:
                    fut.set_exception(e)

    async def _run_event(self, h, name, *args):
        try:
            await h(*args)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            eh = getattr(self, "on_error", None)
            if eh is not None and name != "error":
                try:
                    await eh(name, *args)
                    return
                except Exception:
                    pass
            sys.stderr.write("Ignoring exception in on_%s\n%s" % (name, _clean_tb()))

    async def wait_for(self, event, *, check=None, timeout=None):
        fut = self.loop.create_future()
        self._waiters.append((event, check, fut))
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            raise

    def is_ready(self):
        return self._ready.is_set()

    async def wait_until_ready(self):
        await self._ready.wait()

    def is_closed(self):
        return self._closed

    def get_guild(self, id):
        return next((g for g in self.guilds if g.id == id), None)

    def get_channel(self, id):
        for g in self.guilds:
            c = g.get_channel(id)
            if c:
                return c

    def get_user(self, id):
        return next((u for u in self.users if u.id == id), None)

    get_member = get_user

    async def fetch_user(self, id):
        u = self.get_user(id)
        if u is None:
            raise NotFound("Unknown User")
        return u

    async def fetch_channel(self, id):
        c = self.get_channel(id)
        if c is None:
            raise NotFound("Unknown Channel")
        return c

    async def change_presence(self, *, activity=None, status=None):
        self.activity = activity
        _emit({"type": "presence", "text": getattr(activity, "name", None)})

    async def close(self):
        self._closed = True
        _reset()

    async def setup_hook(self):
        pass

    # simulated login
    def run(self, token=None, *args, **kwargs):
        global _client
        _client = self
        if not token or token == "YOUR_TOKEN_HERE":
            print("[discord] No real token needed in PyPad: running in the local simulator.")
        else:
            print("[discord] Token ignored: PyPad can't open the Discord gateway from iOS. Running in the local simulator.")
        if not self.intents.message_content:
            print("[discord] Note: message_content intent is OFF. Like real Discord, prefix commands will not see message text.")
        _spawn(self._boot())

    async def start(self, token=None, **kw):
        global _client
        _client = self
        await self._boot()

    async def login(self, token=None):
        pass

    async def connect(self, **kw):
        pass

    async def _boot(self):
        g = Guild("PyPad Server")
        you = User(next(_ids), "You")
        you.guild = g
        self.user = User(next(_ids), "PyPadBot", bot=True)
        self.user.guild = g
        g.members = [you, self.user]
        g.owner_id = you.id
        g.channels = g.text_channels = [TextChannel(g, "general"), TextChannel(g, "bot-commands")]
        self.guilds = [g]
        self._guild, self._you = g, you
        try:
            await self.setup_hook()
        except Exception:
            sys.stderr.write("Exception in setup_hook\n" + _clean_tb())
        self.dispatch("connect")
        self._ready.set()
        self.dispatch("ready")
        self.dispatch("guild_join", g)
        _emit({"type": "ready", "bot": {"id": self.user.id, "name": self.user.name}, "you": {"id": you.id, "name": you.name},
               "channels": [c.name for c in g.channels]})
        if js is not None:
            js.PyPad.discordReady(self.user.name)

    async def _sim_message(self, text, channel):
        g = self._guild
        ch = next((c for c in g.channels if c.name == channel), g.channels[0])
        if text.startswith("/") and self._tree is not None:
            if await self._tree._simulate(text[1:], self._you, ch):
                return
        content = text
        if not self.intents.message_content and not (("<@%d>" % self.user.id) in text):
            content = ""
        m = Message(ch, self._you, content)
        m.mentions = [u for u in g.members if ("<@%d>" % u.id) in text]
        _emit({**m._payload(), "content": text})
        _log.append(m)
        self.dispatch("message", m)


def _clean_tb():
    tb = traceback.format_exc().splitlines()
    out, skip = [], False
    for line in tb:
        if line.startswith("  File ") and "/_pypad/" in line:
            skip = True
            continue
        if skip and line.startswith("    "):
            continue
        skip = False
        out.append(line)
    return "\n".join(out) + "\n"


def _sim_input(text, channel="general"):
    if _client is not None and _client._ready.is_set():
        _spawn(_client._sim_message(text, channel))


AutoShardedClient = Client
from . import utils  # noqa: E402
