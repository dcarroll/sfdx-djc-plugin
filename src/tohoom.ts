import { SfCommand } from '@salesforce/sf-plugins-core'
import * as fs from 'fs';
import * as path from 'path';
import { ux } from '@oclif/core';

interface PlanEntry {
  sobject: string;
  saveRefs: boolean;
  resolveRefs: boolean;
  files: string[];
}

interface RecordAttributes {
  type: string;
  referenceId: string;
}

interface TeamMember {
  Name: string;
  Sales_Heirarchy__c: string;
  Sales_Org_Type__c: string;
  Reports_To__c: string;
  attributes: RecordAttributes;
}

interface TeamMemberDataFile {
  totalSize: Number;
  done: Boolean;
  records: Array<TeamMember>;
}

export default class TohoomExtension {
  public static description = 'This command is specific to post processing the Tohoom dataset for handling the self referential Hoom_Team_Member object';

  private planname: string; 
  private targetdir: string;
  private cmd: SfCommand<any>;

  public async run(planName: string, targetDir: string, cmd: SfCommand<any>): Promise<any> {

    this.planname = planName;
    this.targetdir = targetDir;
    this.cmd = cmd;

    ux.log(`Re-jiggering the ${this.planname} data plan found in the ${this.targetdir} direcotry...`);
    await this.addSeedFileToPlan();
    await this.copyHoomTMtoSeedFile();
    ux.log('Finished modifying plan for Tohoom data.');
  }

  private async addSeedFileToPlan() {
    const pathToPlan = path.join(this.targetdir, this.planname + '.json');
    // Read the file into a json structure
    if (!fs.existsSync(pathToPlan)) {
      this.cmd.error(`Could not find the data plan file ${pathToPlan}`);
    } else {
      const plandata: Buffer = fs.readFileSync(pathToPlan);
      const planarray: Array<PlanEntry> = JSON.parse(plandata.toString());
      const ind = planarray.findIndex(element => element.sobject === 'Hoom_Team_Member__c');
      // Found the right item to copy, no we need a copy of it before modifying it and sticking
      // back into the plan entries.
      const planEntry: PlanEntry = JSON.parse(JSON.stringify(planarray[ind]));
      const fileName = planEntry.files[0];
      // Replace the file with the new name
      planEntry.files[0] = fileName.split('.')[0] + '_seed' + '.json';
      // Insert the new plan entry ahead of the original, so this would be ind-1
      planarray.splice(ind, 0, planEntry);
      // Now, write the file back to where it came from
      fs.writeFileSync(pathToPlan, JSON.stringify(planarray, null, 4));
      console.log(JSON.stringify(planarray[0], null, 4));
    }
  }

  private async copyHoomTMtoSeedFile() {
    const pathToData = path.join(this.targetdir, 'Hoom_Team_Member__c.json');
    const pathToSeedData = path.join(this.targetdir, 'Hoom_Team_Member__c_seed.json');
    const HTMData = fs.readFileSync(pathToData);
    const HTMJson = JSON.parse(HTMData.toString());
    const records: Array<TeamMember> = HTMJson.records;
    // Find the first one, this needs to be add to the org before the circular references take place
    const CRO: TeamMember = JSON.parse(JSON.stringify(records.find(record => record.Sales_Heirarchy__c === 'CRO')));
    const FLSM: TeamMember = JSON.parse(JSON.stringify(records.find(record => record.Sales_Heirarchy__c === 'FLSM')));
    delete FLSM.Reports_To__c;

    // Ok, now write theese to reecords to the seed file
    const dataFile: TeamMemberDataFile = {} as TeamMemberDataFile;
    dataFile.done = true;
    dataFile.totalSize = 2;
    dataFile.records = [ CRO, FLSM ];
    fs.writeFileSync(pathToSeedData, JSON.stringify(dataFile, null, 4));
  }
}

