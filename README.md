datatree
=====

[![Version](https://img.shields.io/npm/v/datatree.svg)](https://npmjs.org/package/datatree)
[![License](https://img.shields.io/npm/l/datatree.svg)](https://github.com/dcarroll/datatree/blob/master/package.json)

<!-- toc -->
* [Debugging your plugin](#debugging-your-plugin)
<!-- tocstop -->
<!-- install -->
<!-- usage -->
```sh-session
$ npm install -g datatree
$ datatree COMMAND
running command...
$ datatree (-v|--version|version)
datatree/0.0.0 darwin-x64 node-v9.3.0
$ datatree --help [COMMAND]
USAGE
  $ datatree COMMAND
...
```
<!-- usagestop -->
<!-- commands -->
* [`datatree djc:data:examine`](#datatree-djcdataexamine)

## `datatree djc:data:examine`

Test data export

```
USAGE
  $ datatree djc:data:examine

OPTIONS
  -m, --maxrecords=maxrecords                     [default: 10] Max number of records to return in any query
  -o, --objects=objects                           (required) Comma separated list of objects to fetch
  -t, --targetdir=targetdir                       (required) target directoy to place results in
  -u, --targetusername=targetusername             username or alias for the target org; overrides default target org
  --apiversion=apiversion                         override the api version used for api requests made by this command
  --json                                          format output as json
  --loglevel=(trace|debug|info|warn|error|fatal)  logging level for this command invocation

EXAMPLE
  $ sfdx data:examine -o Account,Contact,Case,Opportunity -t data/exported
```

_See code: [src/commands/djc/data/examine.ts](https://github.com/dcarroll/datatree/blob/v0.0.0/src/commands/djc/data/examine.ts)_
<!-- commandsstop -->
<!-- debugging-your-plugin -->
# Debugging your plugin
We recommend using the Visual Studio Code (VS Code) IDE for your plugin development. Included in the `.vscode` directory of this plugin is a `launch.json` config file, which allows you to attach a debugger to the node process when running your commands.

To debug the `hello:org` command: 
1. Start the inspector
  
If you linked your plugin to the sfdx cli, call your command with the `dev-suspend` switch: 
```sh-session
$ sfdx hello:org -u myOrg@example.com --dev-suspend
```
  
Alternatively, to call your command using the `bin/run` script, set the `NODE_OPTIONS` environment variable to `--inspect-brk` when starting the debugger:
```sh-session
$ NODE_OPTIONS=--inspect-brk bin/run hello:org -u myOrg@example.com
```

2. Set some breakpoints in your command code
3. Click on the Debug icon in the Activity Bar on the side of VS Code to open up the Debug view.
4. In the upper left hand corner of VS Code, verify that the "Attach to Remote" launch configuration has been chosen.
5. Hit the green play button to the left of the "Attach to Remote" launch configuration window. The debugger should now be suspended on the first line of the program. 
6. Hit the green play button at the top middle of VS Code (this play button will be to the right of the play button that you clicked in step #5).
<br><img src=".images/vscodeScreenshot.png" width="480" height="278"><br>
Congrats, you are debugging!
