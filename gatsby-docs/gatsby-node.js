exports.createPages = ({graphql}) =>
// const {createPage} = actions;
	new Promise((resolve, reject) => {
		resolve(graphql(`
        {
          allDocumentationJs {
            edges {
              node {
                name
                examples {
                  raw
                  highlighted
                }
                params {
                  name
                  type {
                    name
                  }
                }
              }
            }
          }
        }
      `).then(result => {
			if (result.errors) {
				console.log(result.errors);
				reject(result.errors);
			}

			// Create pages with JSDocs
			for (const edge of result.data.allDocumentationJs.edges) {
				console.log(edge.node);
			}
		}));
	});
exports.onCreateNode = ({node}) => {
	if (node.internal.type === 'DocumentationJS') {
		console.log(node);
	}
};
