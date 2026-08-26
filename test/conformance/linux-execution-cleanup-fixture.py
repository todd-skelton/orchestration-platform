import hashlib
import importlib.util
import io
import json
import stat
import sys
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("linux_execution_cleanup", sys.argv[1])
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def item(path, kind, inode, mode, uid=1001, gid=1001, content=b""):
    return {
        "device": "1",
        "digest": hashlib.sha256(content).hexdigest() if kind == "FILE" else None,
        "gid": str(gid),
        "inode": str(inode),
        "mode": str(mode),
        "path": path,
        "size": str(len(content) if kind == "FILE" else 0),
        "type": kind,
        "uid": str(uid),
    }


def request(mode="CREATED"):
    parent = "/stable/executions"
    name = "orch6-exec-0000000000000001"
    root = f"{parent}/{name}"
    identities = {
        "candidate": item(f"{root}/candidate.mjs", "FILE", 4, 0o600, content=b"candidate"),
        "root": item(root, "DIRECTORY", 3, 0o700),
        "rpcRunner": item(f"{root}/rpc-runner.mjs", "FILE", 5, 0o600, content=b"rpc"),
        "runtime": item(f"{root}/node", "FILE", 8, 0o600, content=b"runtime"),
        "scratch": item(f"{root}/scratch", "DIRECTORY", 6, 0o700),
    }
    return {
        "ancestors": [
            item("/", "DIRECTORY", 1, 0o755, uid=0, gid=0),
            item("/stable", "DIRECTORY", 2, 0o700),
            item(parent, "DIRECTORY", 7, 0o700),
        ],
        "candidate": identities["candidate"] if mode == "CREATED" else None,
        "executionName": name,
        "mode": mode,
        "root": identities["root"] if mode == "CREATED" else None,
        "rpcRunner": identities["rpcRunner"] if mode == "CREATED" else None,
        "runtime": identities["runtime"] if mode == "CREATED" else None,
        "scratch": identities["scratch"] if mode == "CREATED" else None,
        "stableGid": "1001",
        "stableUid": "1001",
    }


def parse(value):
    stdin = types.SimpleNamespace(buffer=io.BytesIO(json.dumps(value, separators=(",", ":")).encode()))
    with patch.object(helper.sys, "stdin", stdin):
        return helper.read_request()


class Tests(unittest.TestCase):
    def test_closed_created_and_partial_requests(self):
        self.assertEqual(parse(request())["mode"], "CREATED")
        self.assertEqual(parse(request("PARTIAL"))["candidate"], None)
        with self.assertRaises(ValueError):
            parse({**request(), "extra": True})
        duplicate = json.dumps(request())[:-1] + ',"mode":"CREATED"}'
        with patch.object(helper.sys, "stdin", types.SimpleNamespace(buffer=io.BytesIO(duplicate.encode()))):
            with self.assertRaises(ValueError):
                helper.read_request()
        changed = request("PARTIAL")
        changed["candidate"] = request()["candidate"]
        with self.assertRaises(ValueError):
            parse(changed)
        changed = request()
        changed["ancestors"][1] = {**changed["ancestors"][1], "path": "/stable/../stable"}
        with self.assertRaises(ValueError):
            parse(changed)
        changed = request()
        changed["rpcRunner"] = {**changed["rpcRunner"], "inode": changed["candidate"]["inode"]}
        with self.assertRaises(ValueError):
            parse(changed)

    def test_exact_identity_refuses_same_device_replacement_and_digest(self):
        expected = parse(request())["candidate"]
        content = bytearray(b"candidate")

        def profile(inode=4):
            return types.SimpleNamespace(
                st_dev=1,
                st_gid=1001,
                st_ino=inode,
                st_mode=stat.S_IFREG | 0o600,
                st_size=len(content),
                st_uid=1001,
            )

        reads = iter([bytes(content), b""])
        with patch.object(helper.os, "fstat", return_value=profile()), patch.object(
            helper.os, "lseek"
        ), patch.object(helper.os, "read", side_effect=lambda *_: next(reads)):
            helper.require_exact(10, expected, True)
        with patch.object(helper.os, "fstat", return_value=profile(99)):
            with self.assertRaises(RuntimeError):
                helper.require_exact(10, expected)
        content[0] = ord("C")
        reads = iter([bytes(content), b""])
        with patch.object(helper.os, "fstat", return_value=profile()), patch.object(
            helper.os, "lseek"
        ), patch.object(helper.os, "read", side_effect=lambda *_: next(reads)):
            with self.assertRaises(RuntimeError):
                helper.require_exact(10, expected, True)

    def test_created_cleanup_uses_only_fd_relative_fixed_names(self):
        value = parse(request())
        handles = {"root": 20, "candidate": 21, "rpcRunner": 22, "runtime": 23, "scratch": 24}
        open_children = iter([20, 21, 22, 23, 24, 21, 22, 23, 24, 20])
        list_calls = iter([
            ["candidate.mjs", "node", "rpc-runner.mjs", "scratch"],
            [],
            [],
        ])
        output = io.StringIO()
        with patch.object(helper.os, "O_DIRECTORY", 0, create=True), patch.object(
            helper.os, "O_NOFOLLOW", 0, create=True
        ), patch.object(helper.os, "O_CLOEXEC", 0, create=True), patch.object(
            helper.sys, "platform", "linux"
        ), patch.object(
            helper.os, "getuid", return_value=1001, create=True
        ), patch.object(helper.os, "getgid", return_value=1001, create=True), patch.object(
            helper.sys, "argv", ["helper"]
        ), patch.object(helper, "read_request", return_value=value), patch.object(
            helper, "open_ancestors", return_value=[10, 11, 12]
        ), patch.object(helper, "require_chain"), patch.object(
            helper, "require_exact"
        ), patch.object(helper.os, "open", side_effect=lambda *_a, **_k: next(open_children)), patch.object(
            helper.os, "listdir", side_effect=lambda *_: next(list_calls)
        ), patch.object(helper.os, "unlink") as unlink, patch.object(
            helper.os, "rmdir"
        ) as rmdir, patch.object(helper.os, "stat", side_effect=FileNotFoundError), patch.object(
            helper.os, "close"
        ), patch.object(helper.sys, "stdout", output):
            helper.main()
        self.assertEqual(output.getvalue(), '{"ok":true}')
        unlink.assert_any_call("candidate.mjs", dir_fd=handles["root"])
        unlink.assert_any_call("rpc-runner.mjs", dir_fd=handles["root"])
        unlink.assert_any_call("node", dir_fd=handles["root"])
        rmdir.assert_any_call("scratch", dir_fd=handles["root"])
        rmdir.assert_any_call(value["executionName"], dir_fd=12)

    def test_extra_entry_refuses_before_deletion(self):
        value = parse(request("PARTIAL"))
        with patch.object(helper.os, "O_DIRECTORY", 0, create=True), patch.object(
            helper.os, "O_NOFOLLOW", 0, create=True
        ), patch.object(helper.os, "O_CLOEXEC", 0, create=True), patch.object(
            helper.sys, "platform", "linux"
        ), patch.object(
            helper.os, "getuid", return_value=1001, create=True
        ), patch.object(helper.os, "getgid", return_value=1001, create=True), patch.object(
            helper.sys, "argv", ["helper"]
        ), patch.object(helper, "read_request", return_value=value), patch.object(
            helper, "open_ancestors", return_value=[10, 11, 12]
        ), patch.object(helper.os, "open", return_value=20), patch.object(
            helper.os, "listdir", return_value=["extra"]
        ), patch.object(helper.os, "close"), patch.object(helper.os, "unlink") as unlink:
            with self.assertRaises(RuntimeError):
                helper.main()
        unlink.assert_not_called()

    def test_same_device_entry_replacement_refuses_before_rmdir(self):
        expected = parse(request())["scratch"]

        def profile(handle):
            return types.SimpleNamespace(
                st_dev=1,
                st_gid=1001,
                st_ino=6 if handle == 23 else 99,
                st_mode=stat.S_IFDIR | 0o700,
                st_size=0,
                st_uid=1001,
            )

        with patch.object(helper.os, "O_DIRECTORY", 0, create=True), patch.object(
            helper.os, "O_NOFOLLOW", 0, create=True
        ), patch.object(helper.os, "O_CLOEXEC", 0, create=True), patch.object(
            helper.os, "open", return_value=99
        ), patch.object(helper.os, "fstat", side_effect=profile), patch.object(helper.os, "close"):
            with self.assertRaises(RuntimeError):
                helper.require_entry(20, "scratch", 23, expected, "DIRECTORY")

    def test_partial_subset_cleanup_succeeds(self):
        value = parse(request("PARTIAL"))

        def profile(handle):
            directory = handle in (20,)
            return types.SimpleNamespace(
                st_dev=1,
                st_gid=1001,
                st_ino=3 if directory else 4,
                st_mode=(stat.S_IFDIR | 0o700) if directory else (stat.S_IFREG | 0o600),
                st_size=0 if directory else 1,
                st_uid=1001,
            )

        opens = iter([20, 21, 21, 20])
        lists = iter([["candidate.mjs"], [], []])
        output = io.StringIO()
        with patch.object(helper.os, "O_DIRECTORY", 0, create=True), patch.object(
            helper.os, "O_NOFOLLOW", 0, create=True
        ), patch.object(helper.os, "O_CLOEXEC", 0, create=True), patch.object(
            helper.sys, "platform", "linux"
        ), patch.object(helper.os, "getuid", return_value=1001, create=True), patch.object(
            helper.os, "getgid", return_value=1001, create=True
        ), patch.object(helper.sys, "argv", ["helper"]), patch.object(
            helper, "read_request", return_value=value
        ), patch.object(helper, "open_ancestors", return_value=[10, 11, 12]), patch.object(
            helper, "require_chain"
        ), patch.object(helper.os, "open", side_effect=lambda *_a, **_k: next(opens)), patch.object(
            helper.os, "fstat", side_effect=profile
        ), patch.object(helper.os, "listdir", side_effect=lambda *_: next(lists)), patch.object(
            helper.os, "unlink"
        ), patch.object(helper.os, "rmdir"), patch.object(
            helper.os, "stat", side_effect=FileNotFoundError
        ), patch.object(helper.os, "close"), patch.object(helper.sys, "stdout", output):
            helper.main()
        self.assertEqual(output.getvalue(), '{"ok":true}')

    def test_absent_root_is_idempotent(self):
        value = parse(request("PARTIAL"))
        output = io.StringIO()
        with patch.object(helper.os, "O_DIRECTORY", 0, create=True), patch.object(
            helper.os, "O_NOFOLLOW", 0, create=True
        ), patch.object(helper.os, "O_CLOEXEC", 0, create=True), patch.object(
            helper.sys, "platform", "linux"
        ), patch.object(helper.os, "getuid", return_value=1001, create=True), patch.object(
            helper.os, "getgid", return_value=1001, create=True
        ), patch.object(helper.sys, "argv", ["helper"]), patch.object(
            helper, "read_request", return_value=value
        ), patch.object(helper, "open_ancestors", return_value=[10, 11, 12]), patch.object(
            helper.os, "open", side_effect=FileNotFoundError
        ), patch.object(helper.os, "close"), patch.object(helper.os, "unlink") as unlink, patch.object(
            helper.sys, "stdout", output
        ):
            helper.main()
        self.assertEqual(output.getvalue(), '{"ok":true}')
        unlink.assert_not_called()

    def test_close_all_attempts_every_descriptor(self):
        calls = []

        def close(handle):
            calls.append(handle)
            if handle == 1:
                raise OSError("ambiguous close")

        with patch.object(helper.os, "close", side_effect=close):
            with self.assertRaises(RuntimeError):
                helper.close_all([1, 2, 3])
        self.assertEqual(calls, [1, 2, 3])


suite = unittest.defaultTestLoader.loadTestsFromTestCase(Tests)
stream = io.StringIO()
outcome = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
if not outcome.wasSuccessful():
    sys.stderr.write(stream.getvalue())
    raise SystemExit(1)
sys.stdout.write('{"tests":8}')
