#!/usr/bin/env python3
"""Optional POSIX terminal smoke. Synthetic files/model only; not part of Node-only CI."""
import argparse
import errno
import os
import pathlib
import pty
import re
import select
import shutil
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument("--entry", default="src/cli/main.ts")
args = parser.parse_args()
entry = str(pathlib.Path(args.entry).resolve())
node = shutil.which("node")
assert node and pathlib.Path(entry).is_file(), "Build or select a valid CLI entry"
ansi = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")

with tempfile.TemporaryDirectory(prefix="moyyi-cli-pty-") as root:
    root = pathlib.Path(root)
    workspace = root / "workspace"
    workspace.mkdir()
    (workspace / "README.md").write_text("Synthetic PTY fixture.\n")
    data = root / "private"
    plugin = root / "note.mjs"

    def module(version):
        return ("export default {name:'terminal-note',apiVersion:1,setup(host){"
                "host.registerContextSource({id:'terminal-note',collect(){return [{"
                "id:'terminal-note',stability:'static',content:[{type:'text',text:'"
                + version + "'}]}];}});}};")

    plugin.write_text(module("first"))
    master, slave = pty.openpty()
    command = [node, entry, "--demo", "--approve-reads", "-C", str(workspace),
               "--data", str(data), "--dev", "--dev-plugin", "terminal-note=" + str(plugin)]
    process = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave, close_fds=True)
    os.close(slave)
    transcript = ""
    cursor = 0

    def wait(pattern, timeout=12):
        global transcript, cursor
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            clean = ansi.sub("", transcript).replace("\r", "")
            found = re.search(pattern, clean[cursor:])
            if found:
                cursor += found.end()
                return found
            ready, _, _ = select.select([master], [], [], 0.05)
            if ready:
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                transcript += chunk.decode("utf-8", errors="replace")
            if process.poll() is not None:
                break
        raise AssertionError("Missing " + pattern + "\n" + transcript[-5000:])

    def send(text):
        os.write(master, text.encode("utf-8"))

    try:
        session = wait(r"session \| (session_[\w-]+)").group(1)
        wait(r"moyyi> ")
        send("Inspect the README\n")
        effect = wait(r"approval \| (effect_[\w-]+)").group(1)
        wait(r"Use /approve .* or /deny .*")
        send("/approve " + effect + "\n")
        wait(r"tool \| read: succeeded")
        wait(r"run \| completed")
        print("PASS PTY explicit approval and streamed scripted answer")

        send("Inspect it again\n")
        wait(r"approval \| effect_[\w-]+")
        send("Focus on README only\n")
        wait(r"moyyi> ")
        send("\x03")
        wait(r"run \| cancelled")
        print("PASS PTY Ctrl-C during approval; no forced process exit")

        send("/new\n")
        wait(r"session \| session_[\w-]+")
        send("/resume " + session + "\n")
        wait(r"user steering \| Focus on README only")
        wait(r"moyyi> ")
        print("PASS PTY steering persisted and session history resumed")

        plugin.write_text("export default { broken syntax")
        wait(r"plugin \| terminal-note: failed")
        plugin.write_text(module("second"))
        wait(r"plugin \| terminal-note: loaded")
        send("/reload terminal-note\n")
        wait(r"plugin \| terminal-note: loaded")
        print("PASS PTY automatic failure/recovery and manual idle reload")

        send("\x04")
        until = time.monotonic() + 5
        while process.poll() is None and time.monotonic() < until:
            ready, _, _ = select.select([master], [], [], 0.05)
            if ready:
                try:
                    transcript += os.read(master, 65536).decode("utf-8", errors="replace")
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
        assert process.poll() == 0, "EOF did not exit: " + transcript[-5000:]
        resumed = subprocess.run([node, entry, "--demo", "-C", str(workspace), "--data", str(data),
                                  "--session", session, "Continue offline"], capture_output=True,
                                 text=True, timeout=10)
        assert resumed.returncode == 0, resumed.stdout + resumed.stderr
        assert "run | completed" in resumed.stdout
        print("PASS PTY EOF cleanup, write-lock release and process restart")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        os.close(master)
print("5/5 POSIX PTY scenarios passed; temporary session files removed. No API or credentials.")
