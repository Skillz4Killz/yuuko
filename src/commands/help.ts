/** @module Yuuko */

import {Command} from '../Yuuko';

type CommandWithHelp = Command & {help: any};

/**
 * Returns the help text for a command.
 * @param {Command} command The command to get the help text for.
 * @param {string} prefix The prefix to use when generating the text. Used
 * in usage examples within the returned text.
 * @returns {string} The help text.
 */
function helpText (command: CommandWithHelp, prefix: string) {
	let txt = '';
	if (command.help.desc) txt += `**Description:** ${command.help.desc}\n`;
	if (command.help.args) txt += `**Usage:** \`${prefix}${command.names[0]} ${command.help.args}\`\n`;
	const otherNames = command.names.slice(1);
	if (otherNames.length) txt += `**Other names:** ${otherNames.map(p => `\`${prefix}${p}\``).join(', ')}\n`;
	return txt;
}

/**
 * Helper function to emulate the behavior of Array#filter with async functions.
 * Reference: {@link https://stackoverflow.com/a/33401045}
 * @param {Array<*>} array An array of values to filter.
 * @param {*} filter The filter function. The same as a function passed to
 * Array#filter, but resolves to true/false rather than returning true/false.
 * @returns {Array<*>} The filtered array.
 */
async function filterAsync<T> (array: T[], filter: (el: T, i: number, array: T[]) => Promise<boolean>): Promise<T[]> {
	const bits = await Promise.all(array.map((el, i) => filter(el, i, array)));
	return array.filter(() => bits.shift());
}

export default new Command([
	'help',
	'man',
	'h',
], async function help (msg, args, ctx) {
	let prefix = ctx.prefix;
	const client = ctx.client;
	// If the prefix is a mention of the bot, use a blank string instead so our
	// command list output is less terrible
	if (prefix.match(client.mentionPrefixRegExp!)) prefix = '';

	let message;
	// Are we provided any arguments?
	if (args[0]) {
		// Find the command we're talking about
		const command = <CommandWithHelp>client.commandForName(args[0]);
		// If this command doesn't exist or isn't documented, tell the user
		if (!command || !command.help) {
			message = `**=== Help: Unknown Command ===**
		Make sure you spelled the command name right, and that this bot has it. Do \`${prefix}help\` with no arguments to see a list of commands.`;
		} else {
			message = `**=== Help: \`${prefix + command.names[0]}\` ===**\n${helpText(command, prefix)}`;
		}
	} else {
		// Generate a list of commands that the user can execute
		const commandList = (await filterAsync(client.commands, c => c.checkPermissions(msg, args, ctx)))
			.map(c => `\`${prefix}${c.names[0]}\``)
			.join(', ');
		const prefixes = (await client.getPrefixesForMessage(msg, ctx))
			.filter(p => p !== prefix && client.mentionPrefixRegExp && !client.mentionPrefixRegExp.test(p))
			.map(p => `\`${p}\``);
		if (client.allowMention) {
			prefixes.push(client.user.mention);
		}
		const prefixesList = prefixes.join(', ');

		message = `**=== Help: Command List ===**
You can use the following commands: ${commandList}
Other valid prefixes are: ${prefixesList}
Use \`${prefix}help [command]\` to get more info on that command!`;
	}

	// Catch failed message sends - try to send to DMs if the channel is borked
	try {
		await msg.channel.createMessage(message);
	} catch (_) {
		try {
			const channel = await client.getDMChannel(msg.author.id);
			await channel.createMessage(`${message}\n---\n*It appears I can't send messages in the channel you sent that command in, so I've sent my response here instead. Double-check my permissions if this isn't intentional.*`);
		} catch (__) {
			// Blocked DMs or something, don't worry about it
		}
	}
});
export const help = {
	desc: 'Get a list of commands. Pass a command name as an argument to get information about that command.',
	args: '[command]',
};
