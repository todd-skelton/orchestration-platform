import importlib.util
import io
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

fake_pwd = types.ModuleType("pwd")
fake_grp = types.ModuleType("grp")
fake_spwd = types.ModuleType("spwd")
sys.modules["pwd"] = fake_pwd
sys.modules["grp"] = fake_grp
sys.modules["spwd"] = fake_spwd

spec = importlib.util.spec_from_file_location("linux_principal_account", sys.argv[1])
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
real_helper_identity = helper.helper_identity


class Result:
    def __init__(self, code=0, stdout=b"", stderr=b""):
        self.returncode = code
        self.stdout = stdout
        self.stderr = stderr


class Database:
    def __init__(self):
        self.users = {}
        self.groups = {}
        self.calls = []
        self.fail_after = None
        self.password = "!"

    def user(self, name, uid, gid, shell=helper.NOLOGIN):
        return types.SimpleNamespace(pw_name=name, pw_uid=uid, pw_gid=gid, pw_shell=shell)

    def group(self, name, gid, members=()):
        return types.SimpleNamespace(gr_name=name, gr_gid=gid, gr_mem=members)

    def lookup(self, rows, field, value):
        for row in rows.values():
            if getattr(row, field) == value:
                return row
        raise KeyError(value)

    def install(self):
        fake_pwd.getpwnam = lambda value: self.lookup(self.users, "pw_name", value)
        fake_pwd.getpwuid = lambda value: self.lookup(self.users, "pw_uid", value)
        fake_pwd.getpwall = lambda: list(self.users.values())
        fake_grp.getgrnam = lambda value: self.lookup(self.groups, "gr_name", value)
        fake_grp.getgrgid = lambda value: self.lookup(self.groups, "gr_gid", value)
        fake_spwd.getspnam = lambda _value: types.SimpleNamespace(sp_pwdp=self.password)
        helper.os.getgrouplist = lambda name, gid: [gid]
        helper.helper_identity = lambda _path: (1, 2, 0o100755, 0, 0)

    def run(self, arguments, **_options):
        self.calls.append(tuple(arguments))
        command = arguments[0]
        name = arguments[-1]
        if command == helper.GROUPADD:
            gid = int(arguments[arguments.index("--gid") + 1])
            self.groups[name] = self.group(name, gid)
        elif command == helper.USERADD:
            uid = int(arguments[arguments.index("--uid") + 1])
            gid = int(arguments[arguments.index("--gid") + 1])
            self.users[name] = self.user(name, uid, gid)
        elif command == helper.USERDEL:
            self.users.pop(name, None)
        elif command == helper.GROUPDEL:
            self.groups.pop(name, None)
        if self.fail_after == command:
            return Result(1, stderr=b"ambiguous")
        return Result()


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.database = Database()
        self.database.install()
        self.name = "orch6-0000000000000001"
        self.uid = 1_000_001
        self.gid = 1_000_002

    def test_canonical_identity_and_name(self):
        self.assertEqual(helper.canonical_id("1000000"), 1_000_000)
        self.assertEqual(helper.canonical_stable_id("1001"), 1001)
        self.assertEqual(helper.exact_name(self.name), self.name)
        for value in ["", "01", "999999", "2147483647", "１000000"]:
            with self.assertRaises(ValueError):
                helper.canonical_id(value)
        for value in ["0", "01", "-1", "2147483647"]:
            with self.assertRaises(ValueError):
                helper.canonical_stable_id(value)
        with self.assertRaises(ValueError):
            helper.exact_name("candidate")

    def test_create_and_delete_exact_private_identity(self):
        output = io.StringIO()
        with patch.object(helper, "process_identity_rows", return_value=()), patch.object(
            helper.subprocess, "run", side_effect=self.database.run
        ), patch.object(helper.sys, "stdout", output):
            helper.create(self.name, self.uid, self.gid, 1001, 1001)
        self.assertEqual(
            output.getvalue(),
            '{"gid":"1000002","name":"orch6-0000000000000001","uid":"1000001"}',
        )
        helper.require_created(self.name, self.uid, self.gid, 1001, 1001)
        output = io.StringIO()
        with patch.object(helper, "process_identity_rows", return_value=()), patch.object(
            helper.subprocess, "run", side_effect=self.database.run
        ), patch.object(helper.sys, "stdout", output):
            helper.delete(self.name, self.uid, self.gid)
        self.assertEqual(output.getvalue(), '{"ok":true}')
        self.assertEqual(self.database.users, {})
        self.assertEqual(self.database.groups, {})
        groupadd = next(call for call in self.database.calls if call[0] == helper.GROUPADD)
        useradd = next(call for call in self.database.calls if call[0] == helper.USERADD)
        self.assertIn(f"GID_MIN={self.gid}", groupadd)
        self.assertIn(f"GID_MAX={self.gid}", groupadd)
        self.assertIn(f"UID_MIN={self.uid}", useradd)
        self.assertIn(f"UID_MAX={self.uid}", useradd)

    def test_partial_group_or_user_mutation_is_always_reversed(self):
        for failed in [helper.GROUPADD, helper.USERADD]:
            self.database = Database()
            self.database.install()
            self.database.fail_after = failed
            with patch.object(helper, "process_identity_rows", return_value=()), patch.object(
                helper.subprocess, "run", side_effect=self.database.run
            ):
                with self.assertRaises(RuntimeError):
                    helper.create(self.name, self.uid, self.gid, 1001, 1001)
            self.assertEqual(self.database.users, {})
            self.assertEqual(self.database.groups, {})

    def test_refuses_shared_or_supplementary_authority(self):
        self.database.users[self.name] = self.database.user(self.name, self.uid, self.gid)
        self.database.groups[self.name] = self.database.group(self.name, self.gid)
        other = self.database.user("other", 2_000_001, self.gid)
        self.database.users["other"] = other
        with self.assertRaises(RuntimeError):
            helper.require_created(self.name, self.uid, self.gid, 1001, 1001)
        helper.os.getgrouplist = lambda _name, gid: [gid]
        self.database.password = ""
        with self.assertRaises(RuntimeError):
            helper.require_created(self.name, self.uid, self.gid, 1001, 1001)
        self.database.users.pop("other")
        helper.os.getgrouplist = lambda _name, gid: [gid, gid + 1]
        with self.assertRaises(RuntimeError):
            helper.require_created(self.name, self.uid, self.gid, 1001, 1001)

    def test_database_or_process_residue_is_not_absence(self):
        for kind in ["user-name", "user-id", "group-name", "group-id"]:
            self.database = Database()
            self.database.install()
            if kind.startswith("user"):
                name = self.name if kind == "user-name" else "other"
                self.database.users[name] = self.database.user(name, self.uid, self.gid)
            else:
                name = self.name if kind == "group-name" else "other"
                self.database.groups[name] = self.database.group(name, self.gid)
            with patch.object(helper, "process_identity_rows", return_value=()):
                with self.assertRaises(RuntimeError):
                    helper.require_absent(self.name, self.uid, self.gid)
        arms = [
            ((self.uid, 1, 1, 1), (1, 1, 1, 1)),
            ((1, self.uid, 1, 1), (1, 1, 1, 1)),
            ((1, 1, self.uid, 1), (1, 1, 1, 1)),
            ((1, 1, 1, self.uid), (1, 1, 1, 1)),
            ((1, 1, 1, 1), (self.gid, 1, 1, 1)),
            ((1, 1, 1, 1), (1, self.gid, 1, 1)),
            ((1, 1, 1, 1), (1, 1, self.gid, 1)),
            ((1, 1, 1, 1), (1, 1, 1, self.gid)),
        ]
        for row in arms:
            with patch.object(helper, "process_identity_rows", return_value=(row,)):
                with self.assertRaises(RuntimeError):
                    helper.require_no_process_identity(self.uid, self.gid)

    def test_delete_continues_after_ambiguous_user_or_group_result(self):
        for failed in [helper.USERDEL, helper.GROUPDEL]:
            self.database = Database()
            self.database.install()
            self.database.users[self.name] = self.database.user(self.name, self.uid, self.gid)
            self.database.groups[self.name] = self.database.group(self.name, self.gid)
            self.database.fail_after = failed
            with patch.object(helper, "process_identity_rows", return_value=()), patch.object(
                helper.subprocess, "run", side_effect=self.database.run
            ):
                with self.assertRaises(RuntimeError):
                    helper.remove_expected(self.name, self.uid, self.gid)
            self.assertEqual(self.database.users, {})
            self.assertEqual(self.database.groups, {})
            self.assertTrue(any(call[0] == helper.USERDEL for call in self.database.calls))
            self.assertTrue(any(call[0] == helper.GROUPDEL for call in self.database.calls))

    def test_namespace_collision_still_cleans_the_independently_safe_arm(self):
        self.database.users[self.name] = self.database.user(self.name, self.uid + 1, self.gid)
        self.database.groups[self.name] = self.database.group(self.name, self.gid)
        with patch.object(helper, "process_identity_rows", return_value=()), patch.object(
            helper.subprocess, "run", side_effect=self.database.run
        ):
            with self.assertRaises(RuntimeError):
                helper.remove_expected(self.name, self.uid, self.gid)
        self.assertIn(self.name, self.database.users)
        self.assertEqual(self.database.groups, {})

        self.database = Database()
        self.database.install()
        self.database.users[self.name] = self.database.user(self.name, self.uid, self.gid)
        self.database.groups[self.name] = self.database.group(self.name, self.gid + 1)
        with patch.object(helper, "process_identity_rows", return_value=()), patch.object(
            helper.subprocess, "run", side_effect=self.database.run
        ):
            with self.assertRaises(RuntimeError):
                helper.remove_expected(self.name, self.uid, self.gid)
        self.assertEqual(self.database.users, {})
        self.assertIn(self.name, self.database.groups)

    def test_helper_profile_and_command_results_fail_closed(self):
        identity = types.SimpleNamespace(st_mode=0o100755, st_uid=0, st_gid=0, st_dev=1, st_ino=2)
        with patch.object(helper.os, "lstat", return_value=identity):
            self.assertEqual(real_helper_identity(helper.USERADD), (1, 2, 0o100755, 0, 0))
        for mode, uid in [(0o100775, 0), (0o120777, 0), (0o100755, 1)]:
            refused = types.SimpleNamespace(st_mode=mode, st_uid=uid, st_gid=0, st_dev=1, st_ino=2)
            with self.subTest(mode=mode, uid=uid):
                with patch.object(helper.os, "lstat", return_value=refused):
                    with self.assertRaises(RuntimeError):
                        real_helper_identity(helper.USERADD)
        self.database.install()
        for command_result in [Result(1), Result(stdout=b"noise"), Result(stderr=b"noise")]:
            with patch.object(helper, "helper_identity", return_value=(1, 2, 3, 0, 0)), patch.object(
                helper.subprocess, "run", return_value=command_result
            ):
                with self.assertRaises(RuntimeError):
                    helper.command([helper.USERDEL, self.name])
        with patch.object(helper, "helper_identity", side_effect=[(1, 2, 3, 0, 0), (1, 4, 3, 0, 0)]), patch.object(
            helper.subprocess, "run", return_value=Result()
        ):
            with self.assertRaises(RuntimeError):
                helper.command([helper.USERDEL, self.name])

    def test_nss_errors_and_process_row_ambiguity_propagate(self):
        with self.assertRaises(OSError):
            helper.database_lookup(lambda _value: (_ for _ in ()).throw(OSError()), self.name)
        malformed = [
            "Name:\tx\n",
            "Uid:\t1\t2\t3\t4\n",
            "Uid:\t1\t2\t3\t4\nGid:\t1\t2\t3\n",
            "Uid:\t01\t2\t3\t4\nGid:\t1\t2\t3\t4\n",
            "Uid:\t１\t2\t3\t4\nGid:\t1\t2\t3\t4\n",
        ]
        for value in malformed:
            with patch("builtins.open", return_value=io.StringIO(value)):
                with self.assertRaises(RuntimeError):
                    helper.process_identity(9)


suite = unittest.defaultTestLoader.loadTestsFromTestCase(AccountTests)
stream = io.StringIO()
outcome = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
if not outcome.wasSuccessful():
    sys.stderr.write(stream.getvalue())
    raise SystemExit(1)
sys.stdout.write('{"tests":9}')
