const { LuacCli } = require('./src/cli/luac-cli');

function main() {
  const cli = new LuacCli();

  try {
    const exitCode = cli.run(process.argv.slice(2));
    process.exit(exitCode);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
