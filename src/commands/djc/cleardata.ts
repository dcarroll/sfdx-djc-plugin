import * as _ from 'lodash';

import { core, SfdxCommand } from '@salesforce/command';

import { flags } from '@oclif/command';
import { join } from 'path';

import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import * as path from 'path';

import { isString, isUndefined } from 'util';

import { Connection, SfdxError } from '@salesforce/core';
import { Interface } from 'mocha';
import { ExecuteOptions, Query } from 'jsforce';
import { connect } from 'net';

core.Messages.importMessagesDirectory(join(__dirname, '..', '..', '..'));
interface Attributes {
  type: string;
  url: string;
}

export default class ClearData extends SfdxCommand {
  public static description = `Delete data from a scratch org. `;

  public static examples = [
    `$ sfdx djc:cleardata -o Account
  `
  ];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    sobject: flags.string({char: 'o', required: true, description: 'Object to delete all records for'})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  private objects: Array<string>;
  private dataMap = {};
  private globalIds: string[] = [] as string[];

  // tslint:disable-next-line:no-any 
  public async run(): Promise<any> {  
    const conn = this.org.getConnection();
    //await this.clearData(conn, 'Entitlement');
    await this.clearDataViaBulk(conn, this.flags.sobject);
    //await this.clearData(conn, 'Contact');
  }

  protected async clearData(conn: Connection, sobject: string): Promise<any> {
      const data = await conn.autoFetchQuery(`Select Id From ${sobject}`, { maxFetch: 20000});
      const ids = data.records.map(x => {
          return x['Id'];
      });
      return conn.delete(sobject, ids);
  }

  protected async clearDataViaBulk(conn: Connection, sobject:string): Promise<any> {
    const data = await conn.autoFetchQuery(`Select Id From ${sobject}`, { maxFetch: 20000});
    const job = conn.bulk.createJob(sobject, "delete");
    const batch = job.createBatch();
    const cmd:ClearData = this;
    // start job
    if (data.totalSize > 0) {
      return new Promise(function(resolve, reject) {
        batch.execute(data.records);
        // listen for events
        batch.on("error", function(batchInfo) { // fired when batch request is queued in server.
          console.log('Error, batchInfo:', batchInfo);
          reject('Error, batchInfo:'+ JSON.stringify(batchInfo, null, 4));
        });
        batch.on("queue", function(batchInfo) { // fired when batch request is queued in server.
          cmd.ux.log(`Queueing the deletion of ${data.records.length} ${sobject} records.`)
          batch.poll(2000 /* interval(ms) */, 200000 /* timeout(ms) */); // start polling - Do not poll until the batch has started
        });
        batch.on("response", function(rets) { // fired when batch finished and result retrieved
          let successCount: number = 0;
          let errorCount: number =0;
          for (var i=0; i < rets.length; i++) {
            if (rets[i].success) {
              successCount++;
            } else {
              errorCount++;
            }
          }
          cmd.ux.log(`Batch delete finished
              ${successCount} ${sobject} records successfully deleted
              ${errorCount} erros occured`);
          resolve(1);
        });
      });
    }
  }
}
