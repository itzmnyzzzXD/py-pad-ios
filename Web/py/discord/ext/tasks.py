"""discord.ext.tasks: background loops."""
import asyncio, sys, traceback, inspect
import discord


class Loop:
    def __init__(self, coro, seconds=0.0, minutes=0.0, hours=0.0, count=None, reconnect=True, instance=None):
        self.coro, self.count = coro, count
        self.interval = seconds + minutes * 60 + hours * 3600
        self._task, self._before, self._after, self._inst = None, None, None, instance
        self.current_loop = 0
        self._cache = {}

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        if id(obj) not in self._cache:
            l = Loop(self.coro, count=self.count, instance=obj)
            l.interval, l._before, l._after = self.interval, self._before, self._after
            self._cache[id(obj)] = l
        return self._cache[id(obj)]

    def _call(self, f, *a):
        return f(self._inst, *a) if self._inst is not None else f(*a)

    def start(self, *args, **kwargs):
        if self._task is not None and not self._task.done():
            raise RuntimeError("Task is already launched and is not completed.")
        self._task = discord._spawn(self._run(*args, **kwargs))
        return self._task

    async def _run(self, *args, **kwargs):
        try:
            if self._before:
                await self._call(self._before)
            while self.count is None or self.current_loop < self.count:
                try:
                    await self._call(self.coro, *args, **kwargs)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    sys.stderr.write("Unhandled exception in internal background task '%s'.\n%s" % (self.coro.__name__, traceback.format_exc()))
                self.current_loop += 1
                await asyncio.sleep(self.interval)
        finally:
            if self._after:
                try:
                    await self._call(self._after)
                except Exception:
                    pass

    def stop(self):
        if self._task:
            self._task.cancel()

    cancel = stop

    def restart(self, *a, **k):
        self.stop()
        self.current_loop = 0
        self.start(*a, **k)

    def is_running(self):
        return self._task is not None and not self._task.done()

    def before_loop(self, f):
        self._before = f
        return f

    def after_loop(self, f):
        self._after = f
        return f

    async def __call__(self, *a, **k):
        return await self.coro(*a, **k)


def loop(*, seconds=0.0, minutes=0.0, hours=0.0, time=None, count=None, reconnect=True):
    def deco(f):
        return Loop(f, seconds, minutes, hours, count, reconnect)
    return deco
