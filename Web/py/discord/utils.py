"""discord.utils subset."""
import datetime, re, urllib.parse


def find(predicate, iterable):
    for e in iterable:
        if predicate(e):
            return e


def get(iterable, **attrs):
    for e in iterable:
        if all(getattr(e, k.replace("__", "."), None) == v for k, v in attrs.items()):
            return e


def utcnow():
    return datetime.datetime.now(datetime.timezone.utc)


def escape_markdown(text, *, as_needed=False, ignore_links=True):
    return re.sub(r"([\\*_`~|>])", r"\\\1", text)


def escape_mentions(text):
    return text.replace("@everyone", "@\u200beveryone").replace("@here", "@\u200bhere")


def oauth_url(client_id, *, permissions=None, scopes=("bot", "applications.commands"), **kw):
    return "https://discord.com/oauth2/authorize?" + urllib.parse.urlencode({"client_id": client_id, "scope": " ".join(scopes)})


def format_dt(dt, style="f"):
    return "<t:%d:%s>" % (int(dt.timestamp()), style)


def snowflake_time(id):
    return datetime.datetime.fromtimestamp(((id >> 22) + 1420070400000) / 1000, datetime.timezone.utc)
