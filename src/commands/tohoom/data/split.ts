import { flags, SfdxCommand } from "@salesforce/command";
import { Messages } from "@salesforce/core";
import { join } from "path";
import DataApi from "../../../dataApi";

Messages.importMessagesDirectory(join(__dirname, '..', '..', '..'));
// const messages = core.Messages.loadMessages('data', 'export');

export default class Split extends SfdxCommand {
  public static description = `Extract data from an org to use in a scratch org. Just supply a list of SObjects and you *should* end up with a dataset and data plan that can be used with the official force:data:tree:import command`; // messages.getMessage('commandDescription');

  public static examples = [
    `$ sfdx tohoom:data:export -o Account,Contact,Case,Opportunity -t data/exported -n my-testplan
  `
  ];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    // name: flags.string({char: 'n', description: messages.getMessage('nameFlagDescription')})
    planname: flags.string({ default: 'data-plan', description: 'name of the data plan to use with split', char: 'n'})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  // tslint:disable-next-line:no-any 
  public async run(): Promise<any> {  
    this.ux.startSpinner('Determining relationships for ');
    this.ux.stopSpinner('');

    const dapi = new DataApi();
    dapi.run(this.ux, this.flags.planname, this);
    this.ux.startSpinner('Running queries for objects...');
    this.ux.stopSpinner('Saving data...');

    this.ux.log('Finished exporting data and plan.');

  }

}
