import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";

import * as vscode from "vscode";

import * as sln from "../models/solutionModel";
import { spawn } from "child_process";

import { AppConstants, logger } from "../util/Utilities";
import { getDotnetRuntimePath } from "../runtimeManager";

const extensionId = "AvaloniaTeam.vscode-avalonia";

/**
 * Builds the solution model by parsing the solution file and updating the workspace state.
 * If the output file already exists and `force` is false, the function does nothing.
 * @param context The extension context.
 * @param force Whether to force the parsing of the solution file even if the output file already exists.
 */
export async function buildSolutionModel(context: vscode.ExtensionContext, force: boolean = false) {
	var { outputPath, isExist } = await isOutputExists();

	if (!isExist || force) {
		await parseSolution(context);
		return;
	}

	const fileContent = await fs.readFile(outputPath!, "utf-8");
	updateSolutionModel(context, fileContent);
}

/**
 * Returns the solution model from the workspace state.
 * @param context The extension context.
 * @returns The solution model, or undefined if it doesn't exist.
 */
export function getSolutionModel(context: vscode.ExtensionContext): sln.Solution | undefined {
	const solutionData = context.workspaceState.get<sln.Solution | undefined>(AppConstants.solutionData, undefined);
	return solutionData;
}

/**
 * Returns the path to the solution data file.
 * @returns The path to the solution data file, or undefined if it doesn't exist.
 */
export async function getSolutionDataFile() {
	const slnFile = await getSolutionFile();
	if (!slnFile) {
		logger.appendLine("Could not find solution file.");
		return;
	}

	return path.join(os.tmpdir(), `${path.basename(slnFile)}.json`);
}

/**
 * Deletes the solution data file.
 */
export async function purgeSolutionDataFile() {
	const solutionDataFile = await getSolutionDataFile();
	if (!solutionDataFile) {
		return;
	}
	fs.removeSync(solutionDataFile);
}

function updateSolutionModel(context: vscode.ExtensionContext, jsonContect: string) {
	const data = JSON.parse(jsonContect);
	context.workspaceState.update(AppConstants.solutionData, data);
}

async function getSolutionFile(): Promise<string | undefined> {
	const filePattern = "**/*.sln";
	const files = await vscode.workspace.findFiles(filePattern);

	if (files.length > 0) {
		return files[0].fsPath;
	}

	return vscode.workspace.workspaceFolders?.[0].uri.fsPath;
}

async function isOutputExists() {
	const outputPath = await getSolutionDataFile();
	logger.appendLine(`[EXT - INFO] Solution data path path: ${outputPath}`);
	return { outputPath, isExist: fs.pathExistsSync(outputPath!) };
}

async function parseSolution(context: vscode.ExtensionContext): Promise<string> {
	const avaloniaExtn = vscode.extensions.getExtension(extensionId);
	if (!avaloniaExtn) {
		throw new Error("Could not find sample extension.");
	}
	const solutionPath = await getSolutionFile();
	if (!solutionPath) {
		throw new Error("Could not find solution file.");
	}

	const parserLocation = path.join(avaloniaExtn.extensionPath, "solutionParserTool", "SolutionParser.dll");

	return new Promise<string>(async (resolve, reject) => {
		let dotnetCommandPath: string;
		try {
			dotnetCommandPath = await getDotnetRuntimePath();
		}
		catch (error) {
			reject(error);
			return;
		}

		let jsonContent = "";
		const previewer = spawn(dotnetCommandPath.putInQuotes(), [parserLocation.putInQuotes(), solutionPath.putInQuotes()], {
			windowsVerbatimArguments: false,
			env: process.env,
			shell: true,
		});

		previewer.on("spawn", () => {
			jsonContent = "";
			logger.appendLine(`parser process args: ${previewer.spawnargs}`);
		});

		previewer.stdout.on("data", (data) => {
			jsonContent += data.toString();
		});

		let errorData = "";

		previewer.stderr.on("data", (data) => {
			logger.appendLine(data.toString());
			errorData += data.toString();
		});

		previewer.on("close", (code) => {
			logger.appendLine(`parser process exited with code ${code}`);

			if (code === 0) {
				try {
					updateSolutionModel(context, jsonContent);
				}
				catch (error) {
					reject(error);
				}
				resolve(jsonContent);
			}			
			else {
				if (errorData.length === 0)
					errorData = `Solution parser process exited with code ${code}`;

				reject(new Error(errorData));
			}
		});
	});
}
