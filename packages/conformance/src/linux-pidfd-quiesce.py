#!/usr/bin/python3
"""Stable-only Linux UID quiescence helper for ISS-006."""

import os
import signal
import sys
import time


MINIMUM_UID = 1_000_000
MAXIMUM_UID = 2_147_483_646
QUIESCENCE_SECONDS = 10


def canonical_uid(value: str) -> int:
    if not value or not value.isascii() or not value.isdecimal():
        raise ValueError("uid:canonical-decimal-required")
    if value != "0" and value.startswith("0"):
        raise ValueError("uid:canonical-decimal-required")
    uid = int(value, 10)
    if uid < MINIMUM_UID or uid > MAXIMUM_UID:
        raise ValueError("uid:high-unprivileged-range-required")
    return uid


def process_uids(pid: int):
    with open(f"/proc/{pid}/status", "r", encoding="ascii", errors="strict") as handle:
        rows = [line for line in handle if line.startswith("Uid:")]
    if len(rows) != 1:
        raise RuntimeError("process:uid-row-census-refused")
    fields = rows[0].split()
    if len(fields) != 5 or fields[0] != "Uid:":
        raise RuntimeError("process:uid-row-refused")
    values = fields[1:]
    if any(
        not value.isascii()
        or not value.isdecimal()
        or str(int(value, 10)) != value
        for value in values
    ):
        raise RuntimeError("process:uid-value-refused")
    return tuple(int(value, 10) for value in values)


def require_before(deadline: float):
    if time.monotonic() > deadline:
        raise TimeoutError("process:quiescence-timeout")


def uid_processes(uid: int, deadline: float):
    processes = []
    with os.scandir("/proc") as entries:
        for entry in entries:
            require_before(deadline)
            if not entry.name.isascii() or not entry.name.isdecimal():
                continue
            pid = int(entry.name, 10)
            try:
                if uid in process_uids(pid):
                    processes.append(pid)
            except FileNotFoundError:
                continue
    return tuple(sorted(processes))


def signal_identity_checked(pid: int, uid: int, deadline: float):
    require_before(deadline)
    try:
        pidfd = os.pidfd_open(pid, 0)
    except ProcessLookupError:
        return
    try:
        try:
            observed = process_uids(pid)
        except FileNotFoundError:
            return
        if uid not in observed:
            return
        try:
            signal.pidfd_send_signal(pidfd, signal.SIGKILL)
        except ProcessLookupError:
            return
    finally:
        os.close(pidfd)


def quiesce(uid: int):
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise RuntimeError("helper:pidfd-unsupported")
    deadline = time.monotonic() + QUIESCENCE_SECONDS
    if process_uids(os.getpid()) != (0, 0, 0, 0):
        raise PermissionError("helper:root-required")
    empty_scans = 0
    while True:
        require_before(deadline)
        processes = uid_processes(uid, deadline)
        if not processes:
            empty_scans += 1
            if empty_scans == 2:
                return
            time.sleep(0.01)
            continue
        empty_scans = 0
        for pid in processes:
            require_before(deadline)
            signal_identity_checked(pid, uid, deadline)
        time.sleep(0.01)


def alarm_timeout(_signal_number, _frame):
    raise TimeoutError("helper:terminal-timeout")


def main():
    if len(sys.argv) != 2:
        raise ValueError("argv:exact-uid-required")
    if sys.platform != "linux" or not hasattr(signal, "SIGALRM"):
        raise RuntimeError("helper:linux-required")
    uid = canonical_uid(sys.argv[1])
    previous_alarm = signal.signal(signal.SIGALRM, alarm_timeout)
    signal.alarm(QUIESCENCE_SECONDS + 1)
    try:
        quiesce(uid)
        if uid_processes(uid, time.monotonic() + 0.1):
            raise RuntimeError("process:final-residue")
        sys.stdout.write('{"ok":true}')
        sys.stdout.flush()
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_alarm)


if __name__ == "__main__":
    main()
