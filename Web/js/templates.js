'use strict';
const TEMPLATES = [
  {
    id: 'py-hello', name: 'Python: Hello', emoji: '🐍', folder: 'hello-python', main: 'hello.py',
    desc: 'Variables, input(), loops. The classic first script.',
    files: {
      'hello.py': String.raw`# Welcome to PyPad. Tap Run (or press Cmd+Enter).
import platform, random

name = input("What's your name? ")
print(f"Hello, {name}!")
print("Running Python", platform.python_version(), "inside your iPad/iPhone")

for i in range(1, 6):
    print(i, "squared is", i * i)

fortunes = ["Ship it.", "Read the error message.", "Take a walk.", "Add a test."]
print("Fortune:", random.choice(fortunes))
`
    }
  },
  {
    id: 'py-data', name: 'Python: Data + Plot', emoji: '📈', folder: 'data-science', main: 'plot.py',
    desc: 'numpy, pandas and matplotlib. Charts show up in the terminal.',
    files: {
      'plot.py': String.raw`import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

x = np.linspace(0, 4 * np.pi, 300)
df = pd.DataFrame({"x": x, "sin": np.sin(x), "cos": np.cos(x), "damped": np.exp(-x / 6) * np.sin(2 * x)})
print(df.describe().round(3))

fig, ax = plt.subplots(figsize=(7, 3.6))
for col in ["sin", "cos", "damped"]:
    ax.plot(df["x"], df[col], label=col, linewidth=2)
ax.set_title("Waves")
ax.legend()
ax.grid(alpha=.25)
plt.show()
`
    }
  },
  {
    id: 'flask', name: 'Flask web app', emoji: '🧪', folder: 'flask-app', main: 'app.py',
    desc: 'Routes, templates, forms and JSON. Runs live in the Preview tab.',
    files: {
      'app.py': String.raw`from flask import Flask, render_template, request, jsonify, redirect, url_for

app = Flask(__name__)
todos = ["Try PyPad", "Build something great"]


@app.route("/")
def home():
    return render_template("index.html", todos=todos)


@app.route("/add", methods=["POST"])
def add():
    item = request.form.get("item", "").strip()
    if item:
        todos.append(item)
    return redirect(url_for("home"))


@app.route("/api/todos")
def api_todos():
    return jsonify(todos=todos, count=len(todos))


@app.route("/hello/<name>")
def hello(name):
    return f"<h1 style='font-family:sans-serif'>Hello {name}!</h1>"


if __name__ == "__main__":
    app.run(debug=True)
`,
      'templates/index.html': String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Todos</title>
  <link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}">
</head>
<body>
  <main>
    <h1>Todo list</h1>
    <form method="post" action="{{ url_for('add') }}">
      <input name="item" placeholder="What needs doing?" autocomplete="off">
      <button>Add</button>
    </form>
    <ul>
      {% for t in todos %}<li>{{ t }}</li>{% endfor %}
    </ul>
    <p><a href="/api/todos">/api/todos</a> · <a href="/hello/world">/hello/world</a></p>
  </main>
</body>
</html>
`,
      'static/style.css': String.raw`body{font-family:-apple-system,system-ui,sans-serif;background:#0f1420;color:#e8ecf4;margin:0;display:grid;place-items:start center;min-height:100vh}
main{width:min(520px,92vw);padding:28px 0}
h1{letter-spacing:-.02em}
form{display:flex;gap:8px}
input{flex:1;padding:12px;border-radius:12px;border:1px solid #2a3550;background:#151c2c;color:inherit;font-size:16px}
button{padding:12px 18px;border-radius:12px;border:0;background:#ffb454;color:#1c1204;font-weight:800;font-size:16px}
ul{padding:0;list-style:none}
li{padding:12px 14px;margin:8px 0;background:#151c2c;border:1px solid #243049;border-radius:12px}
a{color:#59c2ff}
`
    }
  },
  {
    id: 'web', name: 'Website (HTML/CSS/JS)', emoji: '🌐', folder: 'website', main: 'index.html',
    desc: 'Three linked files. Preview inlines them automatically.',
    files: {
      'index.html': String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>My site</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Built on an iPad.</h1>
    <p>Edit <code>index.html</code>, <code>style.css</code> and <code>script.js</code>, then press Run.</p>
    <button id="btn">Clicked 0 times</button>
  </main>
  <script src="script.js"></script>
</body>
</html>
`,
      'style.css': String.raw`body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,system-ui,sans-serif;background:radial-gradient(circle at 20% 10%,#2b1b4d,#0b0e14 60%);color:#f1f3f9}
main{text-align:center;padding:24px}
h1{font-size:clamp(2rem,8vw,3.4rem);letter-spacing:-.03em;margin:0 0 8px}
code{background:#ffffff18;padding:2px 6px;border-radius:6px}
button{margin-top:18px;padding:14px 24px;border:0;border-radius:999px;font:800 17px inherit;background:linear-gradient(135deg,#ffb454,#ff7a45);color:#1c1204}
`,
      'script.js': String.raw`let n = 0;
const btn = document.getElementById("btn");
btn.addEventListener("click", () => {
  n++;
  btn.textContent = "Clicked " + n + (n === 1 ? " time" : " times");
  console.log("clicks:", n);
});
`
    }
  },
  {
    id: 'js', name: 'JavaScript console', emoji: '⚡', folder: 'javascript', main: 'main.js',
    desc: 'Modern JS with top-level await and use("lodash") for libraries.',
    files: {
      'main.js': String.raw`// Run JavaScript. Output appears in the Terminal tab.
const nums = [5, 3, 8, 1, 9, 2];
console.log("sorted:", [...nums].sort((a, b) => a - b));
console.log("sum:", nums.reduce((a, b) => a + b, 0));

// Load any npm package from a CDN with use():
const _ = await use("lodash");
console.log("chunked:", _.chunk(nums, 2));

const res = await new Promise(r => setTimeout(() => r("async works"), 400));
console.log(res);
console.table({ a: 1, b: 2 });
`
    }
  },
  {
    id: 'canvas', name: 'Canvas playground', emoji: '🎨', folder: 'canvas', main: 'particles.html',
    desc: 'Touch/mouse reactive particles in a single HTML file.',
    files: {
      'particles.html': String.raw`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#070a12;overflow:hidden}canvas{display:block;touch-action:none}</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
const c = document.getElementById("c"), g = c.getContext("2d");
let W, H, pts = [], mouse = { x: -999, y: -999 };
function size() { W = c.width = innerWidth; H = c.height = innerHeight; }
addEventListener("resize", size); size();
for (let i = 0; i < 140; i++) pts.push({ x: Math.random() * W, y: Math.random() * H, vx: Math.random() - .5, vy: Math.random() - .5 });
const move = e => { const p = e.touches ? e.touches[0] : e; mouse.x = p.clientX; mouse.y = p.clientY; };
addEventListener("pointermove", move); addEventListener("touchmove", move);
(function frame() {
  g.fillStyle = "rgba(7,10,18,.25)"; g.fillRect(0, 0, W, H);
  for (const p of pts) {
    const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
    if (d < 120) { p.vx += dx / d * .15; p.vy += dy / d * .15; }
    p.x = (p.x + p.vx + W) % W; p.y = (p.y + p.vy + H) % H; p.vx *= .99; p.vy *= .99;
    g.fillStyle = "hsl(" + ((p.x / W) * 60 + 20) + ",95%,65%)";
    g.beginPath(); g.arc(p.x, p.y, 2.2, 0, 7); g.fill();
  }
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < 70) { g.strokeStyle = "rgba(255,180,84," + (1 - d / 70) * .35 + ")"; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  }
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>
`
    }
  }
];

const SEED_IDS = ['py-hello', 'py-data', 'flask', 'web', 'js'];

async function instantiateTemplate(t) {
  const folder = WS.uniquePath(t.folder);
  await WS.mkdir(folder);
  for (const [p, c] of Object.entries(t.files)) await WS.create(Path.join(folder, p), c);
  return Path.join(folder, t.main);
}
