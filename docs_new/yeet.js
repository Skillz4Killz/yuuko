/* globals Vue, fetch, window, document */

// TOC components

Vue.component('toc-class-member', {
	props: {
		data: Object,
		parent: Object,
	},
	template: `
		<div class="constructor-signatures" v-if="data.kindString === 'Constructor' || data.kindString === 'Method'">
			<!-- div inside ul? why i never -->
			<li
				v-for="signature in data.signatures"
				:key="'toc' + signature.id"
			>
				<a :href="$root.hrefForThing(signature)">
					<code>{{signature.name}}({{$root.paramList(signature.parameters)}})</code>
				</a>
			</li>
		</div>
		<li v-else-if="data.kindString === 'Property'">
			<a :href="$root.hrefForThingProperties(parent)">
				Properties
			</a>
		</li>
	`,
});

Vue.component('toc-entry', {
	props: {
		data: Object,
	},
	computed: {
		filteredChildren () {
			return this.$root.filterChildren(this.data.children);
		},
	},
	template: `
		<li>
			<a :href="$root.hrefForThing(data)">
				{{data.kindString}}: <code>{{data.name}}</code>
			</a>
			<ul v-if="data.children && data.children.length">
				<toc-class-member
					v-for="member in filteredChildren"
					:key="'toc' + member.id"
					:data="member"
					:parent="data"
				/>
			</ul>
		</li>
	`,
});

Vue.component('toc-sidebar', {
	props: {
		things: Array,
		sections: Array,
	},
	template: `
		<aside class="toc">
			<ul>
				<toc-entry
					v-for="data in things"
					:key="'toc' + data.id"
					:data="data"
				/>
			</ul>
		</aside>
	`,
});

// Main content components

Vue.component('type-render', {
	props: {
		type: Object,
	},
	methods: {
		stringify: JSON.stringify,
	},
	template: `
		<span v-if="type.type === 'union'">
			<template v-for="(childType, i) in type.types">
				{{i ? '|' : ''}}
				<type-render :type="childType"/>
			</template>
		</span>
		<span v-else-if="type.type === 'reference'">
			<a v-if="type.id" :href="$root.hrefForThing(type)">
				{{type.name}}
			</a>
			<template v-else>
				{{type.name}}
			</template>
		</span>
		<code v-else-if="type.type === 'intrinsic'">{{type.name}}</code>
		<span v-else-if="type.type === 'array'">
			Array: <type-render :type="type.elementType"/>
		</span>
		<span v-else>
			{{stringify(type)}}
		</span>
	`,
});

Vue.component('thing-display', {
	props: {
		data: Object,
	},
	computed: {
		filteredChildren () {
			return this.$root.filterChildren(this.data.children);
		},
		allProperties () {
			return this.data.children.filter(child => {
				if (child.kindString !== 'Property') return false;
				if (child.flags && child.flags.isPrivate) return false;
				if (child.inheritedFrom) return this.$root.showInherited;
				return true;
			});
		},
	},
	template: `
		<div :id="$root.idForThing(data)">
			<h1>
				{{data.kindString}}: <code>{{data.name}}</code>
				<small v-if="data.extendedTypes && data.extendedTypes.length">
					extends
					<template v-for="(type, i) in data.extendedTypes">
						{{i ? ', ' : ''}}
						<a v-if="type.id" :href="$root.hrefForThing(type)">
							<code>{{type.name}}</code>
						</a>
						<code v-else>Eris.{{type.name}}</code>
					</template>
				</small>
			</h1>
			<p>{{data.comment ? data.comment.shortText : 'No comment :('}}</p>
			<template v-for="child in this.filteredChildren">
				<template v-if="child.kindString === 'Property'">
					<h2 :id="$root.idForThingProperties(data)">
						Properties
					</h2>
					<table>
						<tr>
							<th>Name</th>
							<th>Type</th>
							<th>Description</th>
						</tr>
						<tr v-for="property in allProperties">
							<td>
								<code>{{property.name}}</code>
							</td>
							<td>
								<type-render :type="property.type"/>
							</td>
							<td>
								{{property.comment ? property.comment.shortText : 'No description :('}}
							</td>
						</tr>
					</table>
				</template>
				<template v-if="child.kindString === 'Constructor' || child.kindString === 'Method'">
					<template v-for="signature in child.signatures">
						<h2 :id="$root.idForThing(signature)">
							{{child.kindString}}: <code>{{signature.name}}({{$root.paramList(signature.parameters)}})</code>
						</h2>
						<p>
							{{signature.comment ? signature.comment.shortText : 'No description :('}}
						</p>
						<table>
							<tr>
								<th>Name</th>
								<th>Type</th>
								<th>Description</th>
							</tr>
							<tr v-for="param in signature.parameters">
								<td>
									<code>{{param.name}}</code>
								</td>
								<td>
									<type-render :type="param.type"/>
								</td>
								<td></td>
							</tr>
						</table>
					</template>
				</template>
			</template>
		</div>
	`,
});

// Vue initialization

Vue.component('docs-main', {
	props: {
		things: Array,
	},
	template: `
		<main>
			<template v-for="thing in things">
				<thing-display :data="thing"/>
				<hr/>
			</template>
			<small>Docs generated by Vue! Woo!</small>
		</main>
	`,
});

new Vue({ // eslint-disable-line no-new
	data () {
		return {
			data: null,
			showInherited: false,
		};
	},
	created () {
		fetch('/data.json').then(response => response.json()).then(data => {
			this.data = data;
		});
	},
	methods: {
		idForThing (thing) {
			return `${thing.id}-${thing.name}`.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
		},
		idForThingProperties (thing) {
			return `${this.idForThing(thing)}-properties`;
		},
		hrefForThing (thing) {
			return `#${this.idForThing(thing)}`;
		},
		hrefForThingProperties (thing) {
			return `${this.hrefForThing(thing)}-properties`;
		},
		paramList (parameters) {
			return parameters ? parameters.map(param => param.name).join(', ') : '';
		},
		filterChildren (children) {
			let hasProperties = false;
			return children.filter(thing => {
				if (thing.kindString === 'Property') {
					// just trust me on this one
					// eslint-disable-next-line no-return-assign
					return hasProperties ? false : hasProperties = true;
				}
				if (thing.flags && thing.flags.isPrivate) return false;
				if (thing.inheritedFrom) return this.showInherited;
				return true;
			});
		},
	},
	computed: {
		module () {
			return this.data && this.data.children[0];
		},
		classes () {
			return this.module && this.filterChildren(this.module.children);
		},
	},
	template: `
		<div class="docs-root">
			<toc-sidebar :things="classes"/>
			<docs-main :things="classes"/>
		</div>
	`,
	el: '#app',
	mounted () {
		// wack
		setTimeout(() => {
			if (window.location.hash) {
				const id = window.location.hash.substring(1);
				const el = document.getElementById(id);
				if (el) {
					el.scrollIntoView();
				}
			}
		}, 500);
	},
});
