import fs from "fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const targetVersion = process.env.npm_package_version || pkg.version;

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
fs.writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
fs.writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`, "utf8");

console.log(`Zaktualizowano wersję do ${targetVersion} (minAppVersion: ${minAppVersion}).`);
