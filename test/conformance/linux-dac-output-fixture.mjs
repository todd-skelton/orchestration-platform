const stream = process.argv[2] === "stderr" ? process.stderr : process.stdout;

process.stdout.write('{"ok":true}');
setTimeout(() => {
  stream.write(Buffer.alloc(1024 * 1024 + 1, 120));
}, 20);
