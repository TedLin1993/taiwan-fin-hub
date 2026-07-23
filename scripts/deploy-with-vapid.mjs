import { createECDH } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptDirectory, "..");
const invocationDirectory = process.cwd();
const wranglerScript = join(
  repositoryDirectory,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

const deployArguments = process.argv.slice(2);

function optionArguments(argumentsToInspect, optionNames) {
  const selected = [];

  for (let index = 0; index < argumentsToInspect.length; index += 1) {
    const argument = argumentsToInspect[index];
    const matchingName = optionNames.find(
      (optionName) =>
        argument === optionName || argument.startsWith(`${optionName}=`),
    );

    if (!matchingName) continue;

    selected.push(argument);
    if (argument === matchingName && argumentsToInspect[index + 1]) {
      selected.push(argumentsToInspect[index + 1]);
      index += 1;
    }
  }

  return selected;
}

function runWrangler(argumentsToRun, options = {}) {
  const { captureOutput = false } = options;
  const child = spawn(process.execPath, [wranglerScript, ...argumentsToRun], {
    cwd: invocationDirectory,
    env: {
      ...process.env,
      XDG_CONFIG_HOME:
        process.env.XDG_CONFIG_HOME ?? join(invocationDirectory, ".wrangler-config"),
    },
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });

  if (!captureOutput) {
    return new Promise((resolvePromise, rejectPromise) => {
      child.once("error", rejectPromise);
      child.once("close", (exitCode) => resolvePromise({ exitCode }));
    });
  }

  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("close", (exitCode) =>
      resolvePromise({ exitCode, stdout, stderr }),
    );
  });
}

function generateVapidKeys() {
  const curve = createECDH("prime256v1");
  curve.generateKeys();

  let publicKey = curve.getPublicKey();
  let privateKey = curve.getPrivateKey();

  // Keep the exact fixed-width representation expected by web-push.
  if (privateKey.length < 32) {
    privateKey = Buffer.concat([
      Buffer.alloc(32 - privateKey.length),
      privateKey,
    ]);
  }
  if (publicKey.length < 65) {
    publicKey = Buffer.concat([Buffer.alloc(65 - publicKey.length), publicKey]);
  }

  return {
    publicKey: publicKey.toString("base64url"),
    privateKey: privateKey.toString("base64url"),
  };
}

function isMissingWorkerResult(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  return (
    result.exitCode !== 0 &&
    /worker .* not found|if this is a new worker, run .*wrangler deploy/i.test(
      output,
    )
  );
}

async function existingSecretNames() {
  const contextArguments = optionArguments(deployArguments, [
    "--config",
    "-c",
    "--env",
    "-e",
    "--name",
  ]);
  const result = await runWrangler(
    ["secret", "list", "--format", "json", ...contextArguments],
    { captureOutput: true },
  );

  if (isMissingWorkerResult(result)) {
    return null;
  }

  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to inspect Worker secrets before deployment.\n${result.stderr.trim()}`,
    );
  }

  let secrets;
  try {
    secrets = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `Wrangler returned an unexpected secret list response.\n${result.stdout.trim()}`,
    );
  }

  if (!Array.isArray(secrets)) {
    throw new Error("Wrangler returned an invalid Worker secret list.");
  }

  return new Set(secrets.map((secret) => secret?.name).filter(Boolean));
}

async function deploy() {
  const secrets = await existingSecretNames();
  const hasPublicKey = secrets?.has("VAPID_PUBLIC_KEY") ?? false;
  const hasPrivateKey = secrets?.has("VAPID_PRIVATE_KEY") ?? false;
  const needsInitialKeys = secrets === null || (!hasPublicKey && !hasPrivateKey);

  if (hasPublicKey !== hasPrivateKey && !needsInitialKeys) {
    throw new Error(
      "Worker has only one VAPID secret configured. Refusing to rotate the existing key; restore both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY manually.",
    );
  }

  if (!needsInitialKeys) {
    const result = await runWrangler(["deploy", ...deployArguments]);
    if (result.exitCode !== 0) process.exitCode = result.exitCode ?? 1;
    return;
  }

  const vapidKeys = generateVapidKeys();
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "taiwan-fin-hub-vapid-"),
  );
  const secretsFile = join(temporaryDirectory, "secrets.json");

  try {
    await writeFile(
      secretsFile,
      `${JSON.stringify({
        VAPID_PUBLIC_KEY: vapidKeys.publicKey,
        VAPID_PRIVATE_KEY: vapidKeys.privateKey,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    console.log(
      "[deploy] No VAPID key pair found; generating one for this Worker.",
    );

    const result = await runWrangler([
      "deploy",
      ...deployArguments,
      "--secrets-file",
      secretsFile,
    ]);
    if (result.exitCode !== 0) process.exitCode = result.exitCode ?? 1;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await deploy();
