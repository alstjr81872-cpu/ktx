import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function run(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(
      `Cannot run ${executable}. Install Python 3.10+ or set KORAIL_BOOTSTRAP_PYTHON.`,
    );
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const bootstrap =
  process.env.KORAIL_BOOTSTRAP_PYTHON ??
  (process.platform === "win32" ? "python" : "python3");
run(bootstrap, ["-m", "venv", ".venv"]);
const python = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
run(python, [
  "-m",
  "pip",
  "install",
  "--require-hashes",
  "--only-binary=:all:",
  "--cache-dir",
  path.join(root, ".local", "pip-cache"),
  "-r",
  "requirements-korail.lock",
]);
run(python, [
  "-c",
  "import importlib.metadata; assert importlib.metadata.version('pykorail') == '0.2.1'; print('Korail lookup dependencies ready (pykorail 0.2.1).')",
]);
