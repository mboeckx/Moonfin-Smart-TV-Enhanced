#!/usr/bin/env node
/**
 * Builds the Archive plugin for Jellyfin into the zip Jellyfin installs, and optionally adds it
 * to a plugin repository manifest so a server can install and update it from a repository URL.
 *
 * Usage:
 *   npm run build:jellyfin-plugin                       - version from plugin.json
 *   npm run build:jellyfin-plugin -- 1.2.0              - this version (1.2.0 reads as 1.2.0.0)
 *
 * Flags:
 *   --out <dir>              Where the zip goes (default: the repository root)
 *   --manifest <file>        Add this build to that manifest, creating it when missing
 *   --source-url <url>       Where the zip will be downloaded from, for the manifest
 *   --source-url-base <url>  The same, as the folder holding it; the zip's own name is added
 *
 * Needs the .NET 10 SDK.
 */

const {spawnSync} = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const REPO_ROOT = path.resolve(__dirname, '..');
const PROJECT_DIR = path.join(REPO_ROOT, 'server-plugin', 'Jellyfin.Plugin.Archive');
const PROJECT = path.join(PROJECT_DIR, 'Jellyfin.Plugin.Archive.csproj');

const fail = (message) => {
	console.error(`[x] ${message}`);
	process.exit(1);
};

const parseArgs = (argv) => {
	const options = {out: REPO_ROOT, manifest: null, sourceUrl: null, sourceUrlBase: null, version: null};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			if (i + 1 >= argv.length) fail(`${arg} needs a value`);
			return argv[++i];
		};
		if (arg === '--out') options.out = path.resolve(next());
		else if (arg === '--manifest') options.manifest = path.resolve(next());
		else if (arg === '--source-url') options.sourceUrl = next();
		else if (arg === '--source-url-base') options.sourceUrlBase = next().replace(/\/+$/, '');
		else if (/^v?\d+(\.\d+){2,3}$/.test(arg)) options.version = arg.replace(/^v/, '');
		else fail(`Unknown argument: ${arg}`);
	}
	return options;
};

// Jellyfin compares plugin versions as four numbers.
const fourPart = (version) => {
	const parts = String(version).split('.');
	if (parts.length < 3 || parts.length > 4 || parts.some((part) => !/^\d+$/.test(part))) {
		fail(`Not a version: ${version}`);
	}
	while (parts.length < 4) parts.push('0');
	return parts.join('.');
};

const compareVersions = (a, b) => {
	const x = a.split('.').map(Number);
	const y = b.split('.').map(Number);
	for (let i = 0; i < 4; i++) {
		if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
	}
	return 0;
};

// ── zip ──────────────────────────────────────────────────────────────────────

let crcTable = null;
const crc32 = (buf) => {
	if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
	if (!crcTable) {
		crcTable = new Int32Array(256);
		for (let i = 0; i < 256; i++) {
			let c = i;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
			crcTable[i] = c;
		}
	}
	let crc = -1;
	for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
	return (crc ^ -1) >>> 0;
};

// A flat zip of [{name, data}], deflated, with a fixed date so the same build gives the same bytes.
const zipFiles = (files) => {
	const locals = [];
	const centrals = [];
	let offset = 0;
	const DOS_TIME = 0;
	const DOS_DATE = (2020 - 1980) << 9 | 1 << 5 | 1;
	for (const {name, data} of files) {
		const nameBuf = Buffer.from(name, 'utf8');
		const deflated = zlib.deflateRawSync(data, {level: 9});
		const crc = crc32(data);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(deflated.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, nameBuf, deflated);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt16LE(DOS_TIME, 12);
		central.writeUInt16LE(DOS_DATE, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(deflated.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBuf);

		offset += local.length + nameBuf.length + deflated.length;
	}

	const centralSize = centrals.reduce((sum, buf) => sum + buf.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, ...centrals, end]);
};

// ── build ────────────────────────────────────────────────────────────────────

const main = () => {
	const options = parseArgs(process.argv.slice(2));
	const plugin = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'plugin.json'), 'utf8'));
	const version = fourPart(options.version || plugin.version);
	const timestamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

	const dotnet = spawnSync('dotnet', ['--version'], {encoding: 'utf8', shell: process.platform === 'win32'});
	if (dotnet.status !== 0) fail('The .NET SDK was not found. Install the .NET 10 SDK: https://dotnet.microsoft.com/download');
	console.log(`[build] Archive plugin ${version} with .NET ${dotnet.stdout.trim()}`);

	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-plugin-'));
	try {
		const build = spawnSync('dotnet', [
			'publish', PROJECT,
			'-c', 'Release',
			'-o', outDir,
			`-p:Version=${version}`,
			`-p:AssemblyVersion=${version}`,
			`-p:FileVersion=${version}`,
			'-p:TreatWarningsAsErrors=true',
			'--nologo'
		], {stdio: 'inherit', shell: process.platform === 'win32'});
		if (build.status !== 0) fail('dotnet publish failed');

		const dll = path.join(outDir, plugin.assembly);
		if (!fs.existsSync(dll)) fail(`The build left no ${plugin.assembly}`);

		// What Jellyfin writes next to an installed plugin. Shipping it means a manual install
		// shows the right name and version too.
		const meta = {
			category: plugin.category,
			changelog: plugin.changelog,
			description: plugin.description,
			guid: plugin.guid,
			name: plugin.name,
			overview: plugin.overview,
			owner: plugin.owner,
			targetAbi: plugin.targetAbi,
			timestamp,
			version,
			status: 'Active',
			autoUpdate: true,
			imagePath: '',
			assemblies: [plugin.assembly]
		};

		const zip = zipFiles([
			{name: plugin.assembly, data: fs.readFileSync(dll)},
			{name: 'meta.json', data: Buffer.from(JSON.stringify(meta, null, 2) + '\n')}
		]);
		fs.mkdirSync(options.out, {recursive: true});
		const zipName = `Jellyfin.Plugin.Archive_${version}.zip`;
		const zipPath = path.join(options.out, zipName);
		fs.writeFileSync(zipPath, zip);
		const checksum = crypto.createHash('md5').update(zip).digest('hex');
		console.log(`[ok] ${zipPath} (${(zip.length / 1024).toFixed(0)} KB, md5 ${checksum})`);

		if (options.manifest) {
			const sourceUrl = options.sourceUrl || (options.sourceUrlBase && `${options.sourceUrlBase}/${zipName}`);
			if (!sourceUrl) fail('--manifest needs --source-url or --source-url-base, where Jellyfin will download the zip from');
			let manifest = [];
			if (fs.existsSync(options.manifest)) {
				const text = fs.readFileSync(options.manifest, 'utf8').trim();
				manifest = text ? JSON.parse(text) : [];
			}
			let entry = manifest.find((candidate) => candidate.guid === plugin.guid);
			if (!entry) {
				entry = {guid: plugin.guid, versions: []};
				manifest.push(entry);
			}
			Object.assign(entry, {
				name: plugin.name,
				description: plugin.description,
				overview: plugin.overview,
				owner: plugin.owner,
				category: plugin.category,
				imageUrl: ''
			});
			// The same version built again replaces the one before it.
			entry.versions = (entry.versions || []).filter((existing) => existing.version !== version);
			entry.versions.push({
				version,
				changelog: plugin.changelog,
				targetAbi: plugin.targetAbi,
				sourceUrl,
				checksum,
				timestamp
			});
			entry.versions.sort((a, b) => compareVersions(b.version, a.version));
			fs.mkdirSync(path.dirname(options.manifest), {recursive: true});
			fs.writeFileSync(options.manifest, JSON.stringify(manifest, null, 2) + '\n');
			console.log(`[ok] ${options.manifest} now lists ${entry.versions.length} version(s)`);
		}
	} finally {
		fs.rmSync(outDir, {recursive: true, force: true});
	}
};

main();
