sfdx-djc-plugin
=====

[![Version](https://img.shields.io/npm/v/datatree.svg)](https://npmjs.org/package/sfdx-djc-plugin)
[![License](https://img.shields.io/npm/l/datatree.svg)](https://github.com/dcarroll/sfdx-djc-plugin/blob/master/package.json)


<!-- toc -->
* [sfdx-waw-plugins [![Build Status](https://travis-ci.org/wadewegner/sfdx-waw-plugin.svg?branch=master)](https://travis-ci.org/wadewegner/sfdx-waw-plugin)](#sfdx-waw-plugins-build-status-https-travis-ci-org-wadewegner-sfdx-waw-plugin-svg-branch-master-https-travis-ci-org-wadewegner-sfdx-waw-plugin)
<!-- tocstop -->
<!-- install -->
A plugin for the Salesforce CLI built by Dave Carroll and containing a few of helpful commands.

## Setup

### Install from source

1. Install the SDFX CLI.

2. Clone the repository: `git clone git@github.com:wadewegner/sfdx-waw-plugin.git`

3. Install npm modules: `npm install`

4. Link the plugin: `sfdx plugins:link .`

### Install as plugin

1. Install plugin: `sfdx plugins:install sfdx-waw-plugin`

<!-- usage -->
```sh-session
$ npm install -g sfdx
$ sfdx COMMAND
running command...
$ sfdx (-v|--version|version)
sfdx/0.0.0 darwin-x64 node-v9.3.0
$ sfdx --help [COMMAND]
USAGE
  $ sfdx COMMAND
...
```
<!-- usagestop -->
<!-- commands -->
* [`sfdx djc:data:export`](#sfdx-djcdataexport)

## `sfdx djc:data:export`

This is a proof of concept of a entirely differenct way to extract data from an org to use as developer data for a scratch org.  Just supply a list of SObject, standard or custom, and you *should* end up with a dataset and data plan that can be used with the official force:data:tree:import command

```
USAGE
  $ sfdx djc:data:export

OPTIONS
  -m, --maxrecords=maxrecords                     [default: 10] Max number of records to return in any query

  -n, --planname=planname                         [default: new-plan] name of the data plan to produce, deflaults to
                                                  "new-plan"

  -o, --objects=objects                           (required) Comma separated list of objects to fetch

  -t, --targetdir=targetdir                       (required) target directoy to place results in

  -u, --targetusername=targetusername             username or alias for the target org; overrides default target org

  --apiversion=apiversion                         override the api version used for api requests made by this command

  --json                                          format output as json

  --loglevel=(trace|debug|info|warn|error|fatal)  logging level for this command invocation

EXAMPLE
  $ sfdx djc:data:export -o Account,Contact,Case,Opportunity -t data/exported -n my-testplan
  $ sfdx djc:data:export -o "Account, CustomObj__c, OtherCustomObj__c, Junction_Obj__c" - t data/exported
```

_See code: [src/commands/djc/data/export.ts](https://github.com/dcarroll/datatree/blob/v0.0.0/src/commands/djc/data/export.ts)_
<!-- commandsstop -->
# sfdx-waw-plugins [![Build Status](https://travis-ci.org/wadewegner/sfdx-waw-plugin.svg?branch=master)](https://travis-ci.org/wadewegner/sfdx-waw-plugin)

## Create a Connected App

Simple example: `sfdx waw:connectedapp:create -u <username|alias> -n <ConnectedAppName>`

With a self-signed certificate: `sfdx waw:connectedapp:create -u <username|alias> -n <ConnectedAppName> -r`

Lots of options available:

```
-> sfdx waw:connectedapp:create --help
Usage: sfdx waw:connectedapp:create

Create a connected app in your org

 -c, --callbackurl CALLBACKURL       # callbackUrl (default is "sfdx://success")
 -r, --certificate                   # create and register a certificate
 -d, --description DESCRIPTION       # connected app description
 -n, --name NAME                     # connected app name
 -s, --scopes SCOPES                 # scopes separated by commas (defaut: Basic, Api, Web, Refresh; valid: Basic, Api, Web, Full, Chatter, CustomApplications, RefreshToken, OpenID, CustomPermissions, Wave, Eclair)
 -u, --targetusername TARGETUSERNAME # username or alias for the target org
```

## List a Connected App

List a Connected App: `sfdx waw:connectedapp:list -u <username|alias> -n <ConnectedAppName>`

## Display the details of the project

Display project: `sfdx waw:project:display`

Display package directories: `sfdx waw:project:display -p`

## Set a default package directory

Set default package: `sfdx waw:project:pdir:set -p <directory>`

## Create a package directory in the project file

Create: `sfdx waw:project:pdir:create -p <directory>`

Create as default: `sfdx waw:project:pdir:create -p <directory> -d`

## Delete a package directory in the project file

Delete: `sfdx waw:project:pdir:delete -p <directory>`

## Pull open source into your project

1. Create a new workspace: `sfdx force:workspace:create -n yourname`

2. Get open source: `sfdx waw:source:oss -r WadeWegner/Strike-Components -p force-app/main/default/`

## Create a manifest file to add to your open source project

1. Create a manifest: `sfdx waw:source:create -p force-app/main/default/`

## List all trace flags

`sfdx waw:trace:list`
`sfdx waw:trace:list -u <targetusername>`

## Create a trace flag

`sfdx waw:trace:create`
`sfdx waw:trace:create -u <targetusername>`

## Delete the trace flag

`sfdx waw:trace:delete`
`sfdx waw:trace:delete -u <targetusername>`
