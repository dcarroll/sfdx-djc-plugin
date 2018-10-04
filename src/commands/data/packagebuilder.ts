import { core, SfdxCommand } from '@salesforce/command';
import * as cp from 'child_process';
import { join } from 'path';

core.Messages.importMessagesDirectory(join(__dirname, '..', '..', '..'));
// const messages = core.Messages.loadMessages('data', 'examine');

export default class PackageBuilder extends SfdxCommand {

  public static examples = [
    `$ sfdx data:packagebuilder --targetusername myOrg@example.com
  `
  ];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    // name: flags.string({char: 'n', description: messages.getMessage('nameFlagDescription')})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  // tslint:disable-next-line:no-any
  public async run(): Promise<any> {
    const project = await this.project.retrieveSfdxProjectJson(false);
    // tslint:disable-next-line:no-any
    const dirs: any = project.getContents().get('packageDirectories');
    // tslint:disable-next-line:prefer-for-of
    for (let i = 0; i < dirs.length; i++) {
        const packageDir = dirs[i];
        const createResult = cp.execSync('sfdx force:package2:version:create -i ' + packageDir.id + ' --wait 100');
        process.env.SFDX_PACKAGE_VERSION_ID = createResult['SubscriberPackageVersionId'];
        console.log('SubscriberPackageVersionId: ' + createResult['SubscriberPackageVersionId']);
    }
  }
}
