This library contains custom cli builders for the [Nx](https://nx.dev) monorepo.

Builders:
 -  **web-build** - extends default Nx web builder and avoids creating es5 bundle if not needed for the targeted browsers (https://github.com/nrwl/nx/issues/2749)
 
Installation and usage:
 
1. Install the package via npm or yarn
    
    `npm install nx-builders`
    
    
2. Use the builder in the _workspace.json_. For example: `"builder": "nx-builders:web-build"`
