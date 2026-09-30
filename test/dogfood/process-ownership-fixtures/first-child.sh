# AC1 ordering witness. The harness supplies this file as BASH_ENV, so the
# first launcher child (`bash -c <body>`) sources it before its first body
# command. Only shell builtins run here: reading the records and the injected
# membership forks nothing, and the first write wins (noclobber), so the
# witness is what that child observed at its own start.
if [[ -n "${BASH_EXECUTION_STRING+x}" && -n "${OWNERSHIP_TEST_WITNESS:-}" ]]; then
  enrolled=false
  published=false
  prepared=false
  binding=null
  for directory in "$OWNERSHIP_TEST_RECORDS"/*; do
    if [[ -f "$directory/binding.json" ]]; then
      IFS= read -r record < "$directory/binding.json"
      state=published
    elif [[ -f "$directory/binding.tmp" ]]; then
      IFS= read -r record < "$directory/binding.tmp"
      state=prepared
    else
      continue
    fi
    # Only the binding whose wrapper is this child's parent is ours.
    [[ "$record" =~ \"wrapper\":\{\"pid\":([0-9]+) ]] || continue
    [[ "${BASH_REMATCH[1]}" == "$PPID" ]] || continue
    binding=$record
    if [[ "$state" == published ]]; then published=true; else prepared=true; fi
    if [[ "$record" =~ \"cgroupPath\":\"([^\"]+)\" && -r "${BASH_REMATCH[1]}/cgroup.procs" ]]; then
      while IFS= read -r member; do
        [[ "$member" == "$PPID" ]] && enrolled=true
      done < "${BASH_REMATCH[1]}/cgroup.procs"
    fi
    break
  done
  set -o noclobber
  printf '{"enrolled":%s,"published":%s,"prepared":%s,"firstChildPid":%s,"binding":%s}\n' \
    "$enrolled" "$published" "$prepared" "$BASHPID" "$binding" > "$OWNERSHIP_TEST_WITNESS" 2>/dev/null || true
  set +o noclobber
fi
