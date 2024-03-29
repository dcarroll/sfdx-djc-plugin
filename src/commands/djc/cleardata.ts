import * as _ from 'lodash';
import { join } from 'path';
import * as fs from 'fs';
import { Connection, Messages, SfError, AuthInfo } from '@salesforce/core';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { JsonMap } from '@salesforce/ts-types';
import { ux } from '@oclif/core';

Messages.importMessagesDirectory(join(__dirname, '..', '..', '..'));

export type ClearDataResult = {
  message: string;
  data: JsonMap;
};

export default class ClearData extends SfCommand<ClearDataResult> {
  public static description = `Delete data from a scratch org. `;

  public static examples = [
    `$ sfdx djc:cleardata -o Account
  `
  ];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    sobject: Flags.string({char: 'o', required: true, description: 'Object to delete all records for'})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = true;

  protected conn:Connection;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;


  // tslint:disable-next-line:no-any 
  public async run(): Promise<any> {  
    const { flags } = await this.parse(ClearData);
    //await this.clearData(conn, 'Entitlement');
    // await this.clearDataViaBulk(conn, this.flags.sobject);
    const authInfo = await AuthInfo.create({ username: flags.username });
    this.conn = await Connection.create({ authInfo });
    await this.handleBigData(flags.sobject, await this.getDataToDelete(flags.sobject));
    //await this.clearData(conn, 'Contact');
  }

  protected async getDataToDelete(sobject: string): Promise<Array<any>> {
    const results = await this.conn.autoFetchQuery(`Select Id From ${sobject}`, { maxFetch: 20000});
    ux.log(`Discovered a total of ${results.totalSize} ${sobject} records for deletion.`);
    return results.records;

  }

  protected async handleBigData(sobject: string, dataToDelete: Array<any>): Promise<any> {
    const chunkSize = 10000;
    let numberImported: number = 0;
    let batchNumber: number = 0;
    for (let i=0;i<dataToDelete.length;i += chunkSize) {
      batchNumber++;
      const chunk = dataToDelete.slice(i, i + chunkSize);
      await this.clearDataViaBulk(sobject, chunk, batchNumber);
      numberImported += chunk.length;
    };
    ux.log(`Total ${sobject}s imported = ${numberImported}`);
  }

  protected async clearDataViaBulk(sobject:string, dataToDelete: Array<any>, batchNumber: number): Promise<any> {
    const conn = this.org.getConnection();
    const data = await conn.autoFetchQuery(`Select Id From ${sobject}`, { maxFetch: 20000});
    const job = conn.bulk.createJob(sobject, "delete");
    const batch = job.createBatch();
    //this.ux.log(`Found ${data.totalSize} ${sobject} records to delete`);
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
        batch.on("queue", function() { // fired when batch request is queued in server.
          ux.log(`Queueing the deletion of ${data.records.length} ${sobject} records in batches of 10,000.`)
          batch.poll(2000 /* interval(ms) */, 200000 /* timeout(ms) */); // start polling - Do not poll until the batch has started
        });
        batch.on("response", function(rets) { // fired when batch finished and result retrieved
          let successCount: number = 0;
          let errorCount: number =0;
          let errorOutput:string = '';
          for (var i=0; i < rets.length; i++) {
            if (rets[i].success) {
              successCount++;
            } else {
              errorCount++;
              for (let x = 0;x < rets[i].errors.length; x++) {
                errorOutput = errorOutput + `Error on create: ${rets[i].errors[x]}\n`;
              }
            }
          }
          if (errorCount > 0) {
            ux.log('Errors');
            fs.writeFileSync(`${sobject}_delete_errors.txt`, errorOutput);
          }
            ux.log(`Batch delete finished
              ${successCount} ${sobject} records successfully deleted
              ${errorCount} erros occured, check ${sobject}_delete_errors.txt`);
          resolve(1);
        });
      });
    }
  }
}
