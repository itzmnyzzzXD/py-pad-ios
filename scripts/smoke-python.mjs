import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeDir = path.resolve("Web/vendor/pyodide");
const runtimeUrl = pathToFileURL(runtimeDir + path.sep).href;
const { loadPyodide } = await import(pathToFileURL(path.join(runtimeDir, "pyodide.mjs")).href);

const output = [];
const errors = [];
const pyodide = await loadPyodide({
  indexURL: runtimeUrl,
  stdout: (line) => output.push(String(line)),
  stderr: (line) => errors.push(String(line)),
});

const helperPath = "/home/pyodide/_pypad";
const workspacePath = "/home/pyodide/ws";
pyodide.FS.mkdirTree(helperPath);
pyodide.FS.mkdirTree(workspacePath);

const runtimeSource = await readFile("Web/py/pypad_runtime.py", "utf8");
pyodide.FS.writeFile(path.posix.join(helperPath, "pypad_runtime.py"), runtimeSource);
pyodide.FS.writeFile(path.posix.join(workspacePath, "helper_module.py"), "answer = 42\n");

pyodide.runPython(
  "import sys\n" +
  "sys.path.insert(0, " + JSON.stringify(helperPath) + ")\n" +
  "import pypad_runtime\n"
);

const script = "import helper_module\nprint('script:', helper_module.answer)\n";
const scriptStatus = await pyodide.runPythonAsync(
  "pypad_runtime.prepare(" + JSON.stringify(workspacePath) + ", " + JSON.stringify(workspacePath) + ")\n" +
  "await pypad_runtime.run_code(" + JSON.stringify(script) + ", " + JSON.stringify(workspacePath + "/main.py") + ")"
);
if (scriptStatus !== "ok") throw new Error("Python script smoke test returned: " + scriptStatus);

const replStatus = await pyodide.runPythonAsync(
  "await pypad_runtime.shell_push(" + JSON.stringify("print('repl:', 6 * 7)") + ")"
);
if (replStatus !== "done") throw new Error("Python REPL smoke test returned: " + replStatus);

const joined = output.join("\n");
if (!joined.includes("script: 42")) throw new Error("Python file execution output was missing. Output: " + joined);
if (!joined.includes("repl: 42")) throw new Error("Python REPL output was missing. Output: " + joined);
if (errors.length) console.warn("Python smoke-test stderr:", errors.join("\n"));

console.log("PyPad Python smoke test passed: bundled Pyodide loaded, local module imported, script executed, and REPL executed.");
