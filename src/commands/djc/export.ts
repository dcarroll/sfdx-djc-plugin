import * as _ from 'lodash';
import { join } from 'path';
import * as fs from 'fs';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { JsonMap } from '@salesforce/ts-types';
import { Connection, Messages, SfError, AuthInfo } from '@salesforce/core';
import { ux } from '@oclif/core';

export type ExportResult = {
  message: string;
  data: JsonMap;
};

Messages.importMessagesDirectory(join(__dirname, '..', '..', '..'));
export default class Export extends SfCommand<ExportResult> {
  public static description = `Import data to an org to use in a scratch org. `;

  public static examples = [
    `$ sfdx djc:import -p directory
  `
  ];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    // name: flags.string({char: 'n', description: messages.getMessage('nameFlagDescription')})
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
    const { flags } = await this.parse(Export);
    const accountQuery:string = 'Select Description, Fax, Id, Industry, Name, NumberOfEmployees, Phone, ShippingCity, ShippingCountry, ShippingPostalCode, ShippingState, ShippingStreet, SicDesc, Type, Website From Account';
    const contactQuery:string = 'Select Id, AccountId, Activation_Date__c, Active_Customer__c, Age__c, Customer_Category__c, Customer_Code__c, Customer_Number__c, Customer_Region__c, Customer_Relationship_Type__c, Customer_Tenure__c, Customer_Type__c, Debt_Service__c, Deceased__c, Delinquent_Status__c, Department, Description, Email, Employment_Status__c, ExternalId__c, FirstName, Foreigner__c, Gender__c, Home_Branch_Location__c, HomePhone, Household_Income__c, Industry__c, Joined_By_Channel__c, Last_Date_As_Primary_Customer__c, LastName, MailingCity, MailingCountry, MailingPostalCode, MailingState, MailingStreet, MobilePhone, New_Customer__c, Parent_Legal_Entity__c, Phone, Premier_Customer__c, Primary_Address__c, Primary_Customer__c, Province_Code__c, Race__c  From Contact';
    const bankProductQuery:string = 'Select Bank_Code__c, Category__c, ExternalId__c, Description__c, Id, Minimum_Deposit__c, Name, Online_Application__c, Product_Category__c, Promotion_Type__c  From Bank_Product__c';
    const bankAccountQuery:string = 'Select Account_Age__c, Bank_Product__c, Contact__c, Id, Name From Bank_Account__c';
    const authInfo:AuthInfo = await AuthInfo.create({ username: flags.username });
    this.conn = await Connection.create({ authInfo });
    // First, query for accounts from source org
    await this.getData(this.conn, accountQuery, 'Account');
    await this.getData(this.conn, contactQuery, 'Contact');
    await this.getData(this.conn, bankProductQuery, 'BankProduct');
    await this.getData(this.conn, bankAccountQuery, 'BankAccount');

  }

  private async getData (conn: Connection, query:string, objectType: string) {
    // First, query for accounts from source org
    // let execOptions:QueryOptions = { autoFetch: true, maxFetch: 50000 };
    // execOptions.autoFetch = true;
    let result = await conn.autoFetchQuery(query);

    if (!result.records || result.records.length <= 0) {
      ux.log('Ooops');
      throw new SfError('No records returned for Query!');
    }
    
    let allResults:Array<any> = [];
    allResults = allResults.concat(result.records);
    ux.log(`Gonna write ${objectType} file: ${allResults.length} records out of ${result.totalSize}`);
    fs.writeFileSync(`${objectType}Data.json`, JSON.stringify(allResults, null, 4));
  }
}
