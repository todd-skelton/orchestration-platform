import importlib.util
import io
import json
import stat
import sys
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("linux_principal_dac", sys.argv[1])
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def record(path, kind, mode, uid=1001, gid=1001, inode=1):
    return {
        "device": "1",
        "gid": str(gid),
        "inode": str(inode),
        "mode": str(mode),
        "path": path,
        "type": kind,
        "uid": str(uid),
    }


def request(operation="PREPARE"):
    parent = "/authority-parent"
    root = f"{parent}/execution"
    parent_record = record(parent, "DIRECTORY", 0o700, inode=1)
    return {
        "ancestors": [
            record("/", "DIRECTORY", 0o755, uid=0, gid=0, inode=6),
            parent_record,
        ],
        "candidate": record(f"{root}/candidate.mjs", "FILE", 0o600, inode=3),
        "gid": "1000002",
        "operation": operation,
        "parent": parent_record,
        "root": record(root, "DIRECTORY", 0o700, inode=2),
        "rpcRunner": record(f"{root}/rpc-runner.mjs", "FILE", 0o600, inode=4),
        "scratch": record(f"{root}/scratch", "DIRECTORY", 0o700, inode=5),
        "stableGid": "1001",
        "stableUid": "1001",
        "uid": "1000001",
    }


def parsed(value):
    payload = json.dumps(value, separators=(",", ":")).encode()
    stdin = types.SimpleNamespace(buffer=io.BytesIO(payload))
    with patch.object(helper.sys, "stdin", stdin):
        return helper.read_request()


class Profiles:
    def __init__(self, values):
        self.values = {field: dict(value) for field, value in values.items()}
        self.handles = {field: index + 10 for index, field in enumerate(values)}
        self.by_handle = {handle: field for field, handle in self.handles.items()}
        self.events = []
        self.fail_once = None
        self.fail_before_once = None
        self.fail_chown_before_once = None

    def fake_stat(self, field):
        value = self.values[field]
        file_type = stat.S_IFREG if value["type"] == "FILE" else stat.S_IFDIR
        return types.SimpleNamespace(
            st_dev=value["device"],
            st_gid=value["gid"],
            st_ino=value["inode"],
            st_mode=file_type | value["mode"],
            st_uid=value["uid"],
        )

    def fstat(self, handle):
        return self.fake_stat(self.by_handle[handle])

    def chown(self, handle, uid, gid):
        field = self.by_handle[handle]
        self.events.append(("chown", field, uid, gid))
        if self.fail_chown_before_once == field:
            self.fail_chown_before_once = None
            raise OSError("unapplied chown")
        self.values[field]["uid"] = uid
        self.values[field]["gid"] = gid

    def chmod(self, handle, mode):
        field = self.by_handle[handle]
        self.events.append(("chmod", field, mode))
        if self.fail_before_once == field:
            self.fail_before_once = None
            raise OSError("unapplied chmod")
        self.values[field]["mode"] = mode
        if self.fail_once == field:
            self.fail_once = None
            raise OSError("ambiguous chmod")


class DacTests(unittest.TestCase):
    def test_exact_request_and_duplicate_fields(self):
        value = parsed(request())
        self.assertEqual(value["uid"], 1_000_001)
        self.assertEqual(value["candidate"]["mode"], 0o600)
        duplicate = json.dumps(request())[:-1] + ',"uid":"1000001"}'
        with patch.object(helper.sys, "stdin", types.SimpleNamespace(buffer=io.BytesIO(duplicate.encode()))):
            with self.assertRaises(ValueError):
                helper.read_request()
        for mutation in [
            {**request(), "extra": True},
            {**request(), "uid": "0"},
            {**request(), "stableUid": "0"},
            {**request(), "gid": "1001"},
            {**request(), "ancestors": request()["ancestors"][1:]},
        ]:
            with self.assertRaises(ValueError):
                parsed(mutation)

    def test_profile_formulas_are_exact(self):
        value = parsed(request())
        originals = helper.original_profiles(value)
        granted = helper.granted_profiles(value)
        self.assertEqual(originals["root"]["mode"], 0o700)
        self.assertEqual(granted["root"]["uid"], 0)
        self.assertEqual(granted["root"]["gid"], 1_000_002)
        self.assertEqual(granted["root"]["mode"], 0o510)
        self.assertEqual(granted["candidate"]["mode"], 0o550)
        self.assertEqual(granted["scratch"]["uid"], 1_000_001)
        for field, mode in [("root", 0o710), ("candidate", 0o640), ("scratch", 0o770)]:
            changed = request()
            changed[field] = {**changed[field], "mode": str(mode)}
            with self.assertRaises(RuntimeError):
                helper.original_profiles(parsed(changed))
        changed = request()
        changed["scratch"] = {**changed["scratch"], "device": "2"}
        with self.assertRaises(RuntimeError):
            helper.original_profiles(parsed(changed))

    def test_prepare_applies_only_exact_private_group_dac(self):
        value = parsed(request())
        originals = helper.original_profiles(value)
        profiles = Profiles(originals)
        with patch.object(helper.os, "fstat", side_effect=profiles.fstat), patch.object(
            helper.os, "fchown", side_effect=profiles.chown, create=True
        ), patch.object(helper.os, "fchmod", side_effect=profiles.chmod, create=True):
            helper.prepare(value, profiles.handles, originals)
        self.assertEqual(profiles.values, helper.granted_profiles(value))
        self.assertEqual([event[1] for event in profiles.events if event[0] == "chown"], [
            "candidate",
            "rpcRunner",
            "scratch",
            "root",
        ])

    def test_partial_prepare_restores_every_original_profile(self):
        value = parsed(request())
        originals = helper.original_profiles(value)
        profiles = Profiles(originals)
        profiles.fail_once = "scratch"
        with patch.object(helper.os, "fstat", side_effect=profiles.fstat), patch.object(
            helper.os, "fchown", side_effect=profiles.chown, create=True
        ), patch.object(helper.os, "fchmod", side_effect=profiles.chmod, create=True):
            with self.assertRaises(OSError):
                helper.prepare(value, profiles.handles, originals)
        self.assertEqual(profiles.values, originals)

    def test_restore_revokes_root_before_restoring_children(self):
        value = parsed(request("RESTORE"))
        originals = helper.original_profiles(value)
        profiles = Profiles(helper.granted_profiles(value))
        profiles.values["scratch"]["mode"] = 0o777
        with patch.object(helper.os, "fstat", side_effect=profiles.fstat), patch.object(
            helper.os, "fchown", side_effect=profiles.chown, create=True
        ), patch.object(helper.os, "fchmod", side_effect=profiles.chmod, create=True):
            helper.restore(value, profiles.handles, originals)
        self.assertEqual(profiles.values, originals)
        self.assertEqual(profiles.events[0][1], "root")

    def test_restore_retry_without_scratch_repairs_a_remaining_grant(self):
        value = parsed(request("RESTORE"))
        originals = helper.original_profiles(value)
        profiles = Profiles(helper.granted_profiles(value))
        profiles.fail_chown_before_once = "candidate"
        with patch.object(helper.os, "fstat", side_effect=profiles.fstat), patch.object(
            helper.os, "fchown", side_effect=profiles.chown, create=True
        ), patch.object(helper.os, "fchmod", side_effect=profiles.chmod, create=True):
            issues = helper.restore(value, profiles.handles, originals)
        self.assertIn("identity:candidate-restore-refused", issues)
        self.assertEqual(profiles.values["candidate"], helper.granted_profiles(value)["candidate"])
        scratch_handle = profiles.handles.pop("scratch")
        profiles.by_handle.pop(scratch_handle)
        profiles.values.pop("scratch")
        with patch.object(helper.os, "fstat", side_effect=profiles.fstat), patch.object(
            helper.os, "fchown", side_effect=profiles.chown, create=True
        ), patch.object(helper.os, "fchmod", side_effect=profiles.chmod, create=True):
            self.assertEqual(helper.restore(value, profiles.handles, originals), [])
        self.assertEqual(profiles.values, {field: originals[field] for field in profiles.values})

    def test_restore_repairs_but_reports_a_third_profile(self):
        value = parsed(request("RESTORE"))
        originals = helper.original_profiles(value)
        profiles = Profiles(helper.granted_profiles(value))
        profiles.values["rpcRunner"]["uid"] = 42
        with patch.object(helper.os, "fstat", side_effect=profiles.fstat), patch.object(
            helper.os, "fchown", side_effect=profiles.chown, create=True
        ), patch.object(helper.os, "fchmod", side_effect=profiles.chmod, create=True):
            issues = helper.restore(value, profiles.handles, originals)
            retry_issues = helper.restore(value, profiles.handles, originals)
        self.assertIn("identity:rpcRunner-profile-refused", issues)
        self.assertEqual(retry_issues, [])
        self.assertEqual(profiles.values, originals)

    def test_mount_census_refuses_before_recursive_cleanup(self):
        root = types.SimpleNamespace(st_dev=1)
        child = types.SimpleNamespace(st_dev=2)
        with patch.object(helper.os, "fstat", return_value=root), patch.object(
            helper.os, "fwalk", return_value=[(".", ["mount"], [], 99)], create=True
        ), patch.object(helper.os, "stat", return_value=child):
            with self.assertRaises(RuntimeError):
                helper.require_single_device_tree(10, 1)

    def test_same_device_scratch_entry_replacement_refuses(self):
        value = parsed(request("RESTORE"))
        originals = helper.original_profiles(value)
        profiles = Profiles(originals)
        replacement = profiles.fake_stat("scratch")
        replacement.st_ino = 99
        with patch.object(helper.os, "fstat", side_effect=profiles.fstat), patch.object(
            helper.os, "stat", return_value=replacement
        ):
            with self.assertRaises(RuntimeError):
                helper.require_scratch_entry(
                    profiles.handles["root"], profiles.handles["scratch"], originals["scratch"]
                )

    def test_ancestor_handle_substitution_refuses_recheck(self):
        value = parsed(request("RESTORE"))
        profiles = Profiles({
            "filesystemRoot": value["ancestors"][0],
            "parent": value["ancestors"][1],
        })
        handles = [profiles.handles["filesystemRoot"], profiles.handles["parent"]]
        profiles.values["replacement"] = {**value["ancestors"][1], "inode": 99}
        profiles.by_handle[99] = "replacement"
        with patch.object(helper.os, "O_DIRECTORY", 0, create=True), patch.object(
            helper.os, "O_NOFOLLOW", 0, create=True
        ), patch.object(helper.os, "O_CLOEXEC", 0, create=True), patch.object(
            helper.os, "fstat", side_effect=profiles.fstat
        ), patch.object(
            helper.os, "open", side_effect=[profiles.handles["parent"], 99]
        ), patch.object(helper.os, "close"):
            helper.require_ancestor_custody(handles, value)
            with self.assertRaises(RuntimeError):
                helper.require_ancestor_custody(handles, value)

    def test_main_reaches_restore_with_granted_profiles_and_modified_scratch(self):
        value = parsed(request("RESTORE"))
        originals = helper.original_profiles(value)
        profiles = Profiles(helper.granted_profiles(value))
        profiles.values["scratch"]["mode"] = 0o777
        output = io.StringIO()
        stat_calls = iter([True, False])

        def scratch_stat(*_args, **_kwargs):
            if next(stat_calls):
                return profiles.fake_stat("scratch")
            raise FileNotFoundError()
        with patch.object(helper.os, "O_DIRECTORY", 0, create=True), patch.object(
            helper.os, "O_NOFOLLOW", 0, create=True
        ), patch.object(helper.os, "O_CLOEXEC", 0, create=True), patch.object(
            helper, "process_identity", return_value=((0, 0, 0, 0), (0, 0, 0, 0))
        ), patch.object(
            helper.sys, "platform", "linux"
        ), patch.object(helper.sys, "argv", ["helper"]), patch.object(
            helper.shutil.rmtree, "avoids_symlink_attacks", True
        ), patch.object(helper, "read_request", return_value=value), patch.object(
            helper,
            "open_handles",
            return_value=(profiles.handles, [profiles.handles["parent"]]),
        ), patch.object(helper.os, "fstat", side_effect=profiles.fstat), patch.object(
            helper.os, "fchown", side_effect=profiles.chown, create=True
        ), patch.object(helper.os, "fchmod", side_effect=profiles.chmod, create=True), patch.object(
            helper.os, "close"
        ), patch.object(helper, "require_ancestor_custody"), patch.object(
            helper.os, "stat", side_effect=scratch_stat
        ), patch.object(helper, "require_single_device_tree"), patch.object(
            helper.shutil, "rmtree"
        ) as removed, patch.object(
            helper.os, "listdir", return_value=["candidate.mjs", "rpc-runner.mjs"]
        ), patch.object(helper.sys, "stdout", output):
            helper.main()
        self.assertEqual(output.getvalue(), '{"ok":true}')
        removed.assert_called_once_with("scratch", dir_fd=profiles.handles["root"])
        self.assertEqual(profiles.values, originals)


suite = unittest.defaultTestLoader.loadTestsFromTestCase(DacTests)
stream = io.StringIO()
outcome = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
if not outcome.wasSuccessful():
    sys.stderr.write(stream.getvalue())
    raise SystemExit(1)
sys.stdout.write('{"tests":11}')
