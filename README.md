# sfdx-djc-plugin  [![Build Status](https://travis-ci.org/dcarroll/sfdx-djc-plugin.svg?branch=master)](https://travis-ci.org/dcarroll/sfdx-djc-plugin)

<!-- tocstop -->

[![Version](https://img.shields.io/npm/v/datatree.svg)](https://npmjs.org/package/sfdx-djc-plugin)
[![License](https://img.shields.io/npm/l/datatree.svg)](https://github.com/dcarroll/sfdx-djc-plugin/blob/master/package.json)


<!-- toc -->
* [sfdx-djc-plugin  [![Build Status](https://travis-ci.org/dcarroll/sfdx-djc-plugin.svg?branch=master)](https://travis-ci.org/dcarroll/sfdx-djc-plugin)](#sfdx-djc-plugin-build-status-https-travis-ci-org-dcarroll-sfdx-djc-plugin-svg-branch-master-https-travis-ci-org-dcarroll-sfdx-djc-plugin)
<!-- tocstop -->

<!-- install -->
A plugin for the Salesforce CLI built by Dave Carroll and containing a few of helpful commands.

## Setup

### Install from source

1. Install the SDFX CLI.

2. Clone the repository: `git clone git@github.com:wadewegner/sfdx-djc-plugin.git`

3. Install npm modules: `yarn`

4. Link the plugin: `sfdx plugins:link .`

### Install as plugin

1. Install plugin: `sfdx plugins:install sfdx-tohoom-plugin`

<!-- usage -->
```sh-session
$ npm install -g tohoom-plugin
$ tohoom-plugin COMMAND
running command...
$ tohoom-plugin (-v|--version|version)
tohoom-plugin/0.0.31 darwin-x64 node-v13.12.0
$ tohoom-plugin --help [COMMAND]
USAGE
  $ tohoom-plugin COMMAND
...
```
<!-- usagestop -->
<!-- commands -->
* [`tohoom-plugin djc:cleardata`](#tohoom-plugin-djccleardata)
* [`tohoom-plugin djc:export`](#tohoom-plugin-djcexport)
* [`tohoom-plugin djc:import`](#tohoom-plugin-djcimport)
* [`tohoom-plugin tohoom:data:export`](#tohoom-plugin-tohoomdataexport)
* [`tohoom-plugin tohoom:data:split`](#tohoom-plugin-tohoomdatasplit)

## `tohoom-plugin djc:cleardata`

Delete data from a scratch org.

```
USAGE
  $ tohoom-plugin djc:cleardata

OPTIONS
  -o, --sobject=sobject                            (required) Object to delete all records for
  -u, --targetusername=targetusername              username or alias for the target org; overrides default target org
  -v, --targetdevhubusername=targetdevhubusername  username or alias for the dev hub org; overrides default dev hub org
  --apiversion=apiversion                          override the api version used for api requests made by this command
  --json                                           format output as json
  --loglevel=(trace|debug|info|warn|error|fatal)   logging level for this command invocation

EXAMPLE
  $ sfdx djc:cleardata -o Account
```

_See code: [src/commands/djc/cleardata.ts](https://github.com/dcarroll/datatree/blob/v0.0.31/src/commands/djc/cleardata.ts)_

## `tohoom-plugin djc:export`

Import data to an org to use in a scratch org.

```
USAGE
  $ tohoom-plugin djc:export

OPTIONS
  -u, --targetusername=targetusername              username or alias for the target org; overrides default target org
  -v, --targetdevhubusername=targetdevhubusername  username or alias for the dev hub org; overrides default dev hub org
  --apiversion=apiversion                          override the api version used for api requests made by this command
  --json                                           format output as json
  --loglevel=(trace|debug|info|warn|error|fatal)   logging level for this command invocation

EXAMPLE
  $ sfdx djc:import -p directory
```

_See code: [src/commands/djc/export.ts](https://github.com/dcarroll/datatree/blob/v0.0.31/src/commands/djc/export.ts)_

## `tohoom-plugin djc:import`

Import data to an org to use in a scratch org.

```
USAGE
  $ tohoom-plugin djc:import

OPTIONS
  -i, --findid=findid                              Related record id to find
  -u, --targetusername=targetusername              username or alias for the target org; overrides default target org
  -v, --targetdevhubusername=targetdevhubusername  username or alias for the dev hub org; overrides default dev hub org
  -x, --xfiles                                     Use the limited size files instead of full size files
  --apiversion=apiversion                          override the api version used for api requests made by this command
  --json                                           format output as json
  --loglevel=(trace|debug|info|warn|error|fatal)   logging level for this command invocation

EXAMPLE
  $ sfdx djc:import -p directory
```

_See code: [src/commands/djc/import.ts](https://github.com/dcarroll/datatree/blob/v0.0.31/src/commands/djc/import.ts)_

## `tohoom-plugin tohoom:data:export`

Extract data from an org to use in a scratch org. Just supply a list of SObjects and you *should* end up with a dataset and data plan that can be used with the official force:data:tree:import command

```
USAGE
  $ tohoom-plugin tohoom:data:export

OPTIONS
  -b, --preserveobjectorder                       If present, uses the order of the objects from the command to
                                                  determine plan order

  -e, --enforcereferences                         If present, missing child reference cause the record to be deleted,
                                                  otherwise, just the reference field is removed

  -k, --tohoom                                    Special Tohoom processing to handle self referential relationship

  -m, --maxrecords=maxrecords                     [default: 10] Max number of records to return in any query

  -n, --planname=planname                         [default: new-data-plan] name of the data plan to produce, deflaults
                                                  to "new-plan"

  -o, --objects=objects                           (required) Comma separated list of objects to fetch

  -p, --spiderreferences                          Include refereced SObjects determined by schema examination and
                                                  existing data

  -s, --savedescribes                             Save describe results (for diagnostics)

  -t, --targetdir=targetdir                       (required) target directoy to place results in

  -u, --targetusername=targetusername             username or alias for the target org; overrides default target org

  --apiversion=apiversion                         override the api version used for api requests made by this command

  --json                                          format output as json

  --loglevel=(trace|debug|info|warn|error|fatal)  logging level for this command invocation

EXAMPLE
  $ sfdx tohoom:data:export -o Account,Contact,Case,Opportunity -t data/exported -n my-testplan
```

_See code: [src/commands/tohoom/data/export.ts](https://github.com/dcarroll/datatree/blob/v0.0.31/src/commands/tohoom/data/export.ts)_

## `tohoom-plugin tohoom:data:split`

Extract data from an org to use in a scratch org. Just supply a list of SObjects and you *should* end up with a dataset and data plan that can be used with the official force:data:tree:import command

```
USAGE
  $ tohoom-plugin tohoom:data:split

OPTIONS
  -n, --planname=planname                          [default: data-plan] name of the data plan to use with split
  -v, --targetdevhubusername=targetdevhubusername  username or alias for the dev hub org; overrides default dev hub org
  --apiversion=apiversion                          override the api version used for api requests made by this command
  --json                                           format output as json
  --loglevel=(trace|debug|info|warn|error|fatal)   logging level for this command invocation

EXAMPLE
  $ sfdx tohoom:data:export -o Account,Contact,Case,Opportunity -t data/exported -n my-testplan
```

_See code: [src/commands/tohoom/data/split.ts](https://github.com/dcarroll/datatree/blob/v0.0.31/src/commands/tohoom/data/split.ts)_
<!-- commandsstop -->
