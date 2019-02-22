import * as Eris from 'eris';
import * as glob from 'glob';
import {oneLine} from 'common-tags';
import {Command, CommandName} from './Yuuko'
import {CommandRequirements, PartialCommandContext} from './Command';
import {makeArray} from './util';
// import {CommandContext} from './Command';

/** Helper to get the resolved type of a Promise */
type Resolved<T> = T extends Promise<infer U> ? U : T;

/** The options passed to the client constructor. Includes Eris options. */
export interface ClientOptions extends Eris.ClientOptions {
	/** The bot's token. */
	token: string;
	/** The prefix used to trigger commands. */
	prefix: string;
	/** If true, prefix matching is case-sensitive. */
	caseSensitivePrefix?: boolean;
	/** If true, the bot's mention can be used as an additional prefix. */
	allowMention?: boolean;
	/** If true, messages from other bot accounts will not trigger commands. */
	ignoreBots?: boolean;
	/** If true, requirements set via setGlobalRequirements will be ignored. */
	ignoreGlobalRequirements?: boolean;
}

/** Information returned from the API about the bot's OAuth application. */
// TODO: obviated by https://github.com/abalabahaha/eris/pull/467
export type ClientOAuthApplication =
	Resolved<ReturnType<Client["getOAuthApplication"]>>

/** The client. */
export class Client extends Eris.Client implements ClientOptions {
	/** The token of the bot. */
	token: string;
	/** The prefix used to trigger commands. */
	prefix: string;
	/** If true, prefix matching is case-sensitive. */
	caseSensitivePrefix: boolean = true;
	/** If true, the bot's mention can be used as an additional prefix. */
	allowMention: boolean = true;
	/** If true, messages from other bot accounts will not trigger commands. */
	ignoreBots: boolean = true;
	/** If true, requirements set via setGlobalRequirements will be ignored. */
	ignoreGlobalRequirements: boolean = false;
	/** A list of all loaded commands. */
	commands: Command[] = [];
	/**
	 * A regular expression which matches mention prefixes. Present after the
	 * first `'ready'` event is sent.
	*/
	mentionPrefixRegExp: RegExp | null = null;
	/** Information about the bot's OAuth application. */
	app: ClientOAuthApplication | null = null;
	/** An object of stuff to add to the context object for command functions */
	contextAdditions: object = {};
	/** A requirements object that is applied to all commands */
	globalCommandRequirements: CommandRequirements = {};

	private _gotReady: boolean = false;

	constructor (options: ClientOptions) {
		super(options.token, options); // Do Eris client constructor stuff
		// HACK: Technically this is already set by the super constructor, but
		//       Eris defines token as an optional property even though it's not
		this.token = options.token;

		// Apply options on top of defaults
		// Object.assign(this, options); // eventually maybe we can just do this
		this.prefix = options.prefix;
		if (options.caseSensitivePrefix !== undefined) this.caseSensitivePrefix = options.caseSensitivePrefix;
		if (options.allowMention !== undefined) this.allowMention = options.allowMention;
		if (options.ignoreBots !== undefined) this.ignoreBots = options.ignoreBots;
		if (options.ignoreGlobalRequirements !== undefined) this.ignoreGlobalRequirements = options.ignoreGlobalRequirements;

		// Warn if we're using an empty prefix
		if (this.prefix === '') {
			process.emitWarning(oneLine`
				defaultPrefix is an empty string; bot will not require a prefix
				to run commands
			`);
		}

		// Register the message event listener
		this.on('messageCreate', this.handleMessage);
	}

	/** @override Hijacks the `'ready'` event so we can do custom setup. */
	emit (name: string, ...args: any[]): boolean {
		// We only want to customize the 'ready' event the first time
		if (name !== 'ready' || this._gotReady) return super.emit(name, ...args);
		this._gotReady = true;
		this.mentionPrefixRegExp = new RegExp(`^<@!?${this.user.id}>\\s?`);
		this.getOAuthApplication().then(app => {
			this.app = app;
			/**
			 * @event Client#ready
			 * Overridden from the Eris ready event. Functionally the same, but
			 * only emitted after internal setup of the app and
			 * prefixMentionRegExp properties.
			 */
			super.emit('ready', ...args);
		});
		return !!this.listeners(name).length;
	}

	/** Given a message, see if there is a command and process it if so. */
	private async handleMessage (msg: Eris.Message): Promise<void> {
		if (!msg.author) return; // this is a bug and shouldn't really happen
		if (this.ignoreBots && msg.author.bot) return;

		const matchResult = this.splitPrefixFromContent(msg);
		if (!matchResult) return;
		const [prefix, content] = matchResult;
		// If there is no content past the prefix, we don't have a command
		if (!content) {
			// If we don't have the bot's prefix either, do nothing
			if (!prefix || !prefix.match(this.mentionPrefixRegExp!)) return;
			// A lone mention triggers the default command with no arguments
			const defaultCommand = this.commandForName(null);
			if (!defaultCommand) return;
			defaultCommand.execute(msg, [], Object.assign({
				client: this,
				prefix,
				commandName: null,
			}, this.contextAdditions));
			return;
		}
		const args = content.split(' ');
		const commandName = args.shift();
		if (commandName === undefined) return;
		const command = this.commandForName(commandName);
		if (!command) return;

		const ctx = Object.assign({
			client: this,
			prefix,
			commandName,
		}, this.contextAdditions);
		this.emit('preCommand', command, msg, args, ctx);
		const executed = await command.execute(msg, args, ctx);
		if (executed) {
			this.emit('command', command, msg, args, ctx);
		}
	}

	/** Adds things to the context objects the client sends. */
	addContext(options: object): this {
		Object.assign(this.contextAdditions, options);
		return this;
	}

	/** Set requirements for all commands at once */
	setGlobalRequirements(requirements: CommandRequirements) {
		Object.assign(this.globalCommandRequirements, requirements);
		return this;
	}

	/** Register a command to the client. */
	addCommand (command: Command): this {
		if (!(command instanceof Command)) throw new TypeError('Not a command');
		if (this.commandForName(command.name)) throw new Error(`Command ${command.name} already registered`);
		this.commands.push(command);
		this.emit('commandLoaded', command);
		return this;
	}

	/** Load the files in a directory and attempt to add a command from each. */
	addCommandDir (dirname: string): this {
		if (!dirname.endsWith('/')) dirname += '/';
		const pattern = `${dirname}*.[tj]s`;
		const filenames = glob.sync(pattern);
		for (const filename of filenames) {
			this.addCommandFile(filename);
		}
		return this;
	}

	/** Add a command exported from a file. */
	// TODO: support exporting multiple commands?
	addCommandFile (filename: string): this {
		delete require.cache[filename];
		// js files are expected to use module.exports = new Command(...);
		// ts files are expected to use export default new Command(...);
		let command = require(filename);
		if (command.default instanceof Command) {
			// Use object.assign to preserve other exports
			// TODO: this kinda breaks typescript but it's fine
			command = Object.assign(command.default, command);
			delete command.default;
		} else if (!(command instanceof Command)) {
			throw new TypeError(`File ${filename} does not export a command`);
		}
		command.filename = filename;
		this.addCommand(command);
		return this;
	}

	/**
	 * Reloads all commands that were loaded via `addCommandFile` and
	 * `addCommandDir`. Useful for development to hot-reload commands as you
	 * work on them.
	 */
	reloadCommands (): this {
		// Iterates over the list backwards to avoid overwriting indexes
		let i = this.commands.length;
		while (i--) {
			const command = this.commands[i];
			if (command.filename) {
				this.commands.splice(i, 1);
				this.addCommandFile(command.filename);
			}
		}
		return this;
	}

	/**
	 * Checks the list of registered commands and returns one whch is known by a
	 * given name, either as the command's name or an alias of the command.
	 */
	commandForName (name: CommandName): Command | null {
		return this.commands.find(c => c.names.includes(name)) || null;
	}

	/**
	 * Overridable method for specifying the prefix or prefixes to check a
	 * message for. By default, the prefix passed in the constructor is
	 * returned.
	 */
	prefixes (msg: Eris.Message, ctx: PartialCommandContext): string | string[] | undefined {
		// No custom behavior by default
		return undefined;
	}

	// Takes a message, gets the prefix based on the config of any guild it was
	// sent in, and returns the message's content without the prefix if the
	// prefix matches, and `null` if it doesn't.
	// @param {Eris.Message} msg The message to process
	// @returns {Array<String|null>} An array `[prefix, rest]` if the message
	// matches the prefix, or `[null, null]` if not
	splitPrefixFromContent (msg: Eris.Message): [string, string] | null {
		let prefixes = this.prefixes(msg, Object.assign({
			client: this,
		}, this.contextAdditions));
		if (prefixes === undefined) {
			prefixes = [this.prefix];
		} else {
			prefixes = makeArray(prefixes);
		}

		// Traditional prefix checking
		for (const prefix of prefixes) {
			if (this.caseSensitivePrefix ? msg.content.startsWith(prefix) : msg.content.toLowerCase().startsWith(prefix.toLowerCase())) {
				return [prefix, msg.content.substr(prefix.length)];
			}
		}
		// Allow mentions to be used as prefixes according to config
		if (this.allowMention) {
			const match = msg.content.match(this.mentionPrefixRegExp!);
			if (match) { // TODO: guild config
				return [match[0], msg.content.substr(match[0].length)];
			}
		}
		// Allow no prefix in direct message channels
		if (!(msg.channel instanceof Eris.GuildChannel)) {
			return ['', msg.content];
		}
		// we got nothing
		return null;
	}

	/** @deprecated Alias of `prefix` */
	get defaultPrefix () {
		return this.prefix;
	}
	set defaultPrefix(val: string) {
		this.prefix = val;
	}
}

// Added event definitions
// export declare interface Client extends Eris.Client {
// 	on(event: string, listener: Function): this;
// 	on(event: 'preCommand' | 'command', listener: (
// 		command: Command,
// 		msg: Eris.Message,
// 		args: string[],
// 		ctx: CommandContext,
// 	) => void): this;
// 	on(event: 'commandLoaded', listener: (command: Command) => void): this;
// }
