// Placeholder for root scripts whose code arrives in a later phase (see docs/ROADMAP.md).
const [command = "This command", phase = "a later phase"] = process.argv.slice(2);
console.error(`${command} isn't built yet — it arrives in ${phase} (see docs/ROADMAP.md).`);
process.exit(1);
