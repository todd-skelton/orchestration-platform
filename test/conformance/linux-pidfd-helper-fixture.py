import importlib.util
import io
import os
import signal
import sys
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True

HELPER_PATH = sys.argv[1]
spec = importlib.util.spec_from_file_location("linux_pidfd_quiesce", HELPER_PATH)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class Entries:
    def __init__(self, names):
        self.names = names

    def __enter__(self):
        return [type("Entry", (), {"name": name})() for name in self.names]

    def __exit__(self, *_args):
        return False


def status(*uids):
    return "Name:\tfixture\nUid:\t" + "\t".join(str(uid) for uid in uids) + "\n"


class HelperTests(unittest.TestCase):
    def test_canonical_uid_bounds(self):
        self.assertEqual(helper.canonical_uid("1000000"), 1_000_000)
        self.assertEqual(helper.canonical_uid("2147483646"), 2_147_483_646)
        for value in ["", "01", "999999", "2147483647", "１000000", "x"]:
            with self.assertRaises(ValueError):
                helper.canonical_uid(value)

    def test_status_census_and_malformed_rows(self):
        with patch("builtins.open", return_value=io.StringIO(status(1, 2, 3, 4))):
            self.assertEqual(helper.process_uids(7), (1, 2, 3, 4))
        malformed = [
            "Name:\tx\n",
            status(1, 2, 3, 4) + status(1, 2, 3, 4),
            "Uid:\t1\t2\t3\n",
            "Uid:\t01\t2\t3\t4\n",
            "Uid:\t１\t2\t3\t4\n",
        ]
        for value in malformed:
            with patch("builtins.open", return_value=io.StringIO(value)):
                with self.assertRaises(RuntimeError):
                    helper.process_uids(7)

    def test_finds_each_uid_arm_and_tolerates_only_disappearance(self):
        values = {
            10: status(1_000_001, 1, 1, 1),
            11: status(1, 1_000_001, 1, 1),
            12: status(1, 1, 1_000_001, 1),
            13: status(1, 1, 1, 1_000_001),
        }

        def opened(path, *_args, **_kwargs):
            pid = int(path.split("/")[2])
            if pid == 14:
                raise FileNotFoundError()
            return io.StringIO(values[pid])

        with patch.object(helper.os, "scandir", return_value=Entries(["10", "11", "12", "13", "14", "x"])), patch(
            "builtins.open", side_effect=opened
        ), patch.object(helper.time, "monotonic", return_value=0):
            self.assertEqual(helper.uid_processes(1_000_001, 1), (10, 11, 12, 13))
        with patch.object(helper.os, "scandir", return_value=Entries(["10"])), patch(
            "builtins.open", side_effect=PermissionError()
        ), patch.object(helper.time, "monotonic", return_value=0):
            with self.assertRaises(PermissionError):
                helper.uid_processes(1_000_001, 1)

    def test_pidfd_revalidation_never_signals_unrelated_identity(self):
        sent = Mock()
        closed = Mock()
        with patch.object(helper.signal, "SIGKILL", 9, create=True), patch.object(
            helper.os, "pidfd_open", return_value=77, create=True
        ), patch.object(
            helper, "process_uids", return_value=(1_000_001,) * 4
        ), patch.object(helper.signal, "pidfd_send_signal", sent, create=True), patch.object(
            helper.os, "close", closed
        ), patch.object(helper.time, "monotonic", return_value=0):
            helper.signal_identity_checked(9, 1_000_001, 1)
            sent.assert_called_once_with(77, 9)
            closed.assert_called_once_with(77)
        sent.reset_mock()
        closed.reset_mock()
        with patch.object(helper.signal, "SIGKILL", 9, create=True), patch.object(
            helper.os, "pidfd_open", return_value=77, create=True
        ), patch.object(
            helper, "process_uids", return_value=(2_000_001,) * 4
        ), patch.object(helper.signal, "pidfd_send_signal", sent, create=True), patch.object(
            helper.os, "close", closed
        ), patch.object(helper.time, "monotonic", return_value=0):
            helper.signal_identity_checked(9, 1_000_001, 1)
            sent.assert_not_called()
            closed.assert_called_once_with(77)
        with patch.object(
            helper.os, "pidfd_open", side_effect=ProcessLookupError(), create=True
        ), patch.object(
            helper.time, "monotonic", return_value=0
        ):
            helper.signal_identity_checked(9, 1_000_001, 1)

    def test_pidfd_failures_close_or_propagate_exactly(self):
        closed = Mock()
        with patch.object(helper.signal, "SIGKILL", 9, create=True), patch.object(
            helper.os, "pidfd_open", return_value=77, create=True
        ), patch.object(helper, "process_uids", return_value=(1_000_001,) * 4), patch.object(
            helper.signal, "pidfd_send_signal", side_effect=ProcessLookupError(), create=True
        ), patch.object(helper.os, "close", closed), patch.object(
            helper.time, "monotonic", return_value=0
        ):
            helper.signal_identity_checked(9, 1_000_001, 1)
            closed.assert_called_once_with(77)
        closed.reset_mock()
        with patch.object(helper.signal, "SIGKILL", 9, create=True), patch.object(
            helper.os, "pidfd_open", return_value=77, create=True
        ), patch.object(helper, "process_uids", return_value=(1_000_001,) * 4), patch.object(
            helper.signal, "pidfd_send_signal", side_effect=PermissionError(), create=True
        ), patch.object(helper.os, "close", closed), patch.object(
            helper.time, "monotonic", return_value=0
        ):
            with self.assertRaises(PermissionError):
                helper.signal_identity_checked(9, 1_000_001, 1)
            closed.assert_called_once_with(77)
        with patch.object(
            helper.os, "pidfd_open", side_effect=PermissionError(), create=True
        ), patch.object(helper.time, "monotonic", return_value=0):
            with self.assertRaises(PermissionError):
                helper.signal_identity_checked(9, 1_000_001, 1)

    def test_quiescence_root_arms_repeated_absence_and_deadline(self):
        with patch.object(helper.os, "pidfd_open", create=True), patch.object(
            helper.signal, "pidfd_send_signal", create=True
        ), patch.object(helper, "process_uids", return_value=(0, 0, 0, 0)), patch.object(
            helper, "uid_processes", side_effect=[(9,), (), ()]
        ), patch.object(helper, "signal_identity_checked") as signalled, patch.object(
            helper.time, "monotonic", return_value=0
        ), patch.object(helper.time, "sleep"):
            helper.quiesce(1_000_001)
            signalled.assert_called_once()
        for root_uids in [(1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)]:
            with patch.object(helper.os, "pidfd_open", create=True), patch.object(
                helper.signal, "pidfd_send_signal", create=True
            ), patch.object(helper, "process_uids", return_value=root_uids):
                with self.assertRaises(PermissionError):
                    helper.quiesce(1_000_001)
        with patch.object(helper.os, "pidfd_open", create=True), patch.object(
            helper.signal, "pidfd_send_signal", create=True
        ), patch.object(helper, "process_uids", return_value=(0, 0, 0, 0)), patch.object(
            helper.time, "monotonic", side_effect=[0, 11]
        ):
            with self.assertRaises(TimeoutError):
                helper.quiesce(1_000_001)

    def test_deadlines_inside_enumeration_signalling_and_fork_storm(self):
        with patch.object(helper.os, "scandir", return_value=Entries(["10", "11"])), patch(
            "builtins.open", return_value=io.StringIO(status(1, 1, 1, 1))
        ), patch.object(helper.time, "monotonic", side_effect=[0, 2]):
            with self.assertRaises(TimeoutError):
                helper.uid_processes(1_000_001, 1)
        with patch.object(helper.os, "pidfd_open", create=True), patch.object(
            helper.signal, "pidfd_send_signal", create=True
        ), patch.object(helper, "process_uids", return_value=(0, 0, 0, 0)), patch.object(
            helper, "uid_processes", return_value=(9, 10)
        ), patch.object(helper, "signal_identity_checked"), patch.object(
            helper.time, "monotonic", side_effect=[0, 0, 0, 11]
        ):
            with self.assertRaises(TimeoutError):
                helper.quiesce(1_000_001)
        ticks = iter(range(100))
        with patch.object(helper.os, "pidfd_open", create=True), patch.object(
            helper.signal, "pidfd_send_signal", create=True
        ), patch.object(helper, "process_uids", return_value=(0, 0, 0, 0)), patch.object(
            helper, "uid_processes", return_value=(9,)
        ), patch.object(helper, "signal_identity_checked"), patch.object(
            helper.time, "monotonic", side_effect=lambda: next(ticks)
        ), patch.object(helper.time, "sleep"):
            with self.assertRaises(TimeoutError):
                helper.quiesce(1_000_001)

    def test_main_terminal_contract_and_failure_arms(self):
        stdout = io.StringIO()
        alarms = Mock()
        installed = Mock(return_value="previous")
        with patch.object(helper.sys, "argv", ["helper", "1000001"]), patch.object(
            helper.sys, "platform", "linux"
        ), patch.object(helper.signal, "SIGALRM", 14, create=True), patch.object(
            helper.signal, "signal", installed
        ), patch.object(helper.signal, "alarm", alarms, create=True), patch.object(
            helper, "quiesce"
        ), patch.object(helper, "uid_processes", return_value=()), patch.object(
            helper.time, "monotonic", return_value=0
        ), patch.object(helper.sys, "stdout", stdout):
            helper.main()
        self.assertEqual(stdout.getvalue(), '{"ok":true}')
        self.assertEqual(alarms.call_args_list[0].args, (11,))
        self.assertEqual(alarms.call_args_list[-1].args, (0,))
        self.assertEqual(installed.call_args_list[-1].args, (14, "previous"))
        with patch.object(helper.sys, "argv", ["helper"]):
            with self.assertRaises(ValueError):
                helper.main()
        with patch.object(helper.sys, "argv", ["helper", "1000001"]), patch.object(
            helper.sys, "platform", "win32"
        ):
            with self.assertRaises(RuntimeError):
                helper.main()
        with self.assertRaises(TimeoutError):
            helper.alarm_timeout(14, None)
        with patch.object(helper.sys, "argv", ["helper", "1000001"]), patch.object(
            helper.sys, "platform", "linux"
        ), patch.object(helper.signal, "SIGALRM", 14, create=True), patch.object(
            helper.signal, "signal", return_value="previous"
        ), patch.object(helper.signal, "alarm", create=True), patch.object(
            helper, "quiesce"
        ), patch.object(helper, "uid_processes", return_value=(9,)), patch.object(
            helper.time, "monotonic", return_value=0
        ):
            with self.assertRaises(RuntimeError):
                helper.main()


suite = unittest.defaultTestLoader.loadTestsFromTestCase(HelperTests)
stream = io.StringIO()
outcome = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
if not outcome.wasSuccessful():
    sys.stderr.write(stream.getvalue())
    raise SystemExit(1)
sys.stdout.write('{"tests":8}')
