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
import { ExecuteOptions, Query, RecordResult } from 'jsforce';
import { connect } from 'net';
import { resolve } from 'url';

core.Messages.importMessagesDirectory(join(__dirname, '..', '..', '..'));
interface Attributes {
  type: string;
  url: string;
}

interface Contact {
  attributes: Attributes;
  Id: string;
  AccountId: string;
  Activation_Date__c: string;
  Active_Customer__c: boolean;
  Age__c: number;
  Customer_Category__c: string;
  Customer_Code__c: string;
  Customer_Number__c: number;
  Customer_Region__c: string;
  Customer_Relationship_Type__c: string;
  Customer_Tenure__c: string;
  Customer_Type__c: string;
  Debt_Service__c: string;
  Deceased__c: boolean;
  Delinquent_Status__c: string;
  Department: string;
  Description: string;
  Email: string;
  Employment_Status__c: string;
  ExternalId__c: string;
  FirstName: string;
  Foreigner__c: false;
  Gender__c: string;
  Home_Branch_Location__c: string;
  HomePhone: string;
  Household_Income__c: number;
  Industry__c: string;
  Joined_By_Channel__c: string;
  Last_Date_As_Primary_Customer__c: string;
  LastName: string;
  MailingCity: string;
  MailingCountry: string;
  MailingPostalCode: string;
  MailingState: string;
  MailingStreet: string;
  MobilePhone: string;
  Name: string;
  New_Customer__c: string;
  Parent_Legal_Entity__c: string;
  Phone: string;
  Premier_Customer__c: boolean;
  Primary_Address__c: boolean;
  Primary_Customer__c: boolean;
  Province_Code__c: string;
  Race__c: string;
  UpdatedId: string;
}

interface Account {
    attributues: Attributes;
    Description: string;
    Fax: string;
    Id: string;
    Industry: string;
    IsBuyer: boolean;
    Name: string;
    NumberOfEmployees: number;
    Phone: string;
    PhotoUrl: string;
    ShippingCity: string;
    ShippingCountry: string;
    ShippingPostalCode: string;
    ShippingState: string;
    ShippingStreet: string;
    SicDesc: string;
    Type: string;
    Website: string;
    UpdatedId: string;
}

interface Bank_Account {
  attributes: Attributes;
  Account_Age__c: number;
  Bank_Product__c: string;
  Contact__c: string;
  Id: string;
  Name: string;
  UpdatedId: string;
}

interface Bank_Product {
  attributes: Attributes;
  Bank_Code__c: string;
  Category__c: string;
  ExternalId__c: string;
  Id: string;
  Minimum_Deposit__c: number;
  Name: string;
  Online_Application__c: boolean;
  Product_Category__c: string;
  Promotion_Type__c: string;
  UpdatedId: string;
}

export default class Import extends SfdxCommand {
  public static description = `Import data to an org to use in a scratch org. `;

  public static examples = [
    `$ sfdx djc:import -p directory
  `
  ];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    xfiles: flags.boolean({ char: 'x', description: 'Use the limited size files instead of full size files'})
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
  private accounts: Array<Account>;
  private contacts: Array<Contact>;
  private bankproducts: Array<Bank_Product>;
  private bankaccounts: Array<Bank_Account>;

  // Import Accounts
  // Update the accounts with new Ids
  // Read in Contacts
  // Update the AccountId with the new Account Id
  // Import the contacts
  // Update the contact with the new Ids
  // Import the Bank Products
  // Update the bank products with the new Ids
  // Read in the Bank Accounts
  // Update the Contact Id and the Bank Product Id with the new Ids
  // Import the Bank Accounts
  // tslint:disable-next-line:no-any 
  public async run(): Promise<any> {
    this.loadDataFiles(this.flags.xfiles);

    //this.excludeAccountsWithNoContacts();
    //this.excludeContactsWithoutAnAccountInGoldFileX();
    //this.excludeBankAccountsWithNoContactOrProduct();

    this.summarizeImportOperation();
    await this.handleBigData('Account', this.accounts)
    .then(() => {
      return this.updateContactAccountIds();
    }).then(() => {
      return this.handleBigData('Contact', this.contacts);
    }).then(() => {
      return this.handleBigData('Bank_Product__c', this.bankproducts);
    }).then(() => {
      return this.updateBankAccountIds()
    }).then(() => {
      return this.handleBigData('Bank_Account__c', this.bankaccounts);
    });
  }

  protected async handleBigData(sobject: string, dataToLoad: Array<any>): Promise<any> {
    const chunkSize = 10000;
    let numberImported: number = 0;
    let batchNumber: number = 0;
    for (let i=0;i<dataToLoad.length;i += chunkSize) {
      batchNumber++;
      const chunk = dataToLoad.slice(i, i + chunkSize);
      await this.insertViaBulkApi2(sobject, chunk, batchNumber);
      numberImported += chunk.length;
    };
    this.ux.log(`Total ${sobject}s imported = ${numberImported}`);
  }

  protected async insertViaBulkApi2(sobject:string, dataToLoad:Array<any>, batchNumber: number): Promise<any> {
    // Create job and batch
    const conn:Connection = this.org.getConnection();
    const job = conn.bulk.createJob(sobject, "insert");
    const batch = job.createBatch();
    // start job
    const cmd:Import = this;

    return new Promise(function(resolve, reject) {
      batch.execute(dataToLoad);
      // listen for events
      batch.on("error", function(batchInfo) { // fired when batch request is queued in server.
        cmd.ux.error('Error, batchInfo:', batchInfo);
        reject('Error, batchInfo:'+ JSON.stringify(batchInfo, null, 4));
      });
      batch.on("queue", function(batchInfo) { // fired when batch request is queued in server.
        cmd.ux.log(`Queued batch for ${dataToLoad.length} ${sobject} records.`);
        // poll(interval(ms), timeout(ms))
        batch.poll(2000, 200000); // start polling - Do not poll until the batch has started
      });
      batch.on("response", function(rets) { // fired when batch finished and result retrieved
        let successCount:number = 0;
        let errorCount:number = 0;
        let errorOutput:string = '';
        for (var i=0; i < rets.length; i++) {
          if (rets[i].success) {
            dataToLoad[i].UpdatedId = rets[i].id;
            successCount++;
          } else {
            errorCount++;
            for (let x = 0;x < rets[i].errors.length; x++) {
              errorOutput = errorOutput + `Error on create: ${rets[i].errors[x]}\n`;
            }
          }
        }
        if (errorCount > 0) {
          cmd.ux.log('Errors');
          fs.writeFileSync(`${sobject}_insert_errors-${batchNumber}.txt`, errorOutput);
        }
        cmd.ux.log(`Batch insert finished
              ${successCount} ${sobject} records successfully inserted
              ${errorCount} erros occured, check ${sobject}_insert_errors.txt`);
        resolve(1);
      });
    });
  }

  protected summarizeImportOperation() {
    this.ux.log(`
    Will import the following data:
      ${this.accounts.length} Accounts
      ${this.contacts.length} Contacts
      ${this.bankproducts.length} Bank Products
      ${this.bankaccounts.length} Bank Accounts`);
  }

  protected loadDataFiles(xfiles: boolean) {
    //const filepostfix: string = (xfiles ? 'x' : '');
    //this.accounts = JSON.parse(fs.readFileSync(`AccountData_GF${filepostfix}.json`, 'utf8').toString());
    //this.contacts = JSON.parse(fs.readFileSync('ContactData_GF.json', 'utf8').toString());
    //this.bankproducts = JSON.parse(fs.readFileSync('BankProductData_GF.json', 'utf8').toString());
    //this.bankaccounts = JSON.parse(fs.readFileSync('BankAccountData_GF.json', 'utf8').toString());
    this.accounts = JSON.parse(fs.readFileSync(`AccountData.json`, 'utf8').toString());
    this.contacts = JSON.parse(fs.readFileSync('ContactData.json', 'utf8').toString());
    this.bankproducts = JSON.parse(fs.readFileSync('BankProductData.json', 'utf8').toString());
    this.bankaccounts = JSON.parse(fs.readFileSync('BankAccountData.json', 'utf8').toString());
  }

  protected findRecord(dataToSearch:Array<any>, idTofind:string, fieldToLookIn:string) {
    return dataToSearch.find(record => {
      return record[fieldToLookIn] === idTofind;
    })
  }

  protected async updateContactAccountIds(): Promise<any> {
    for (let i:number = 0; i < this.contacts.length; i++ ) {
      const account:Account = this.accounts.find(d => d.Id === this.contacts[i].AccountId);
      if (account !== undefined) {
        this.contacts[i].AccountId = account.UpdatedId;
      }
    }
  }

  protected async updateBankAccountIds(): Promise<any> {
    for (let i:number = 0; i < this.bankaccounts.length; i++ ) {
      const contact:Contact = this.contacts.find(d => d.Id === this.bankaccounts[i].Contact__c);
      if (contact !== undefined) {
        this.bankaccounts[i].Contact__c = contact.UpdatedId;
        const bankProduct:Bank_Product = this.bankproducts.find(d => d.Id === this.bankaccounts[i].Bank_Product__c);
        this.bankaccounts[i].Bank_Product__c = bankProduct.UpdatedId;
      }
    }
    return;
  }

  /*protected async importAndUpdateAccounts(conn: Connection, cmd: Import): Promise<any> {
    //this.accounts = JSON.parse(fs.readFileSync('AccountData_GFx.json', 'utf8').toString());
    const results:any = await conn.insert('Account', this.accounts)
    cmd.ux.log('Got results?');
    let successes:number = 0;
    let failures:number = 0;
    for (let i = 0; i < results.length; i++) {
      if (results[i].success === true) {
        successes++;
        this.accounts[i].UpdatedId = results[i].id;
      } else {
        failures++;
      }
    }
    this.ux.log(`Imported ${successes} records with ${failures} failures`);
    fs.writeFileSync('importedAccounts.json', JSON.stringify(this.accounts, null, 4));
  }*/

  /*protected async importAndUpdateContacts(conn: Connection): Promise<any> {
    //this.contacts = JSON.parse(fs.readFileSync('ContactData_GFx.json', 'utf8').toString());
    const results:any = await conn.insert('Contact', this.contacts)
    this.ux.log('Got results?');
    for (let i = 0; i < results.length; i++) {
      this.contacts[i].UpdatedId = results[i].id;
    }
    fs.writeFileSync('importedContacts.json', JSON.stringify(this.contacts, null, 4));
  }*/

  /*protected async importAndUpdateBankProducts(): Promise<any> {
    //this.bankproducts = JSON.parse(fs.readFileSync('BankProductData_GF.json', 'utf8').toString());
    const results:any = await this.org.getConnection().insert('Bank_Product__c', this.bankproducts)
    this.ux.log('Got results?');
    for (let i = 0; i < results.length; i++) {
      this.bankproducts[i].UpdatedId = results[i].id;
    }
    fs.writeFileSync('importedBankProducts.json', JSON.stringify(this.accounts, null, 4));
    return;
  }*/

  protected async importAndUpdateBankAccounts(conn: Connection, cmd: Import) {
    //this.bankaccounts = JSON.parse(fs.readFileSync('BankAccountData_GFx.json', 'utf8').toString());
    for (let i:number = 0; i < this.bankaccounts.length; i++ ) {
      const contact:Contact = this.contacts.find(d => d.Id === this.bankaccounts[i].Contact__c);
      this.bankaccounts[i].Contact__c = contact.UpdatedId;
      const bankProduct:Bank_Product = this.bankproducts.find(d => d.Id === this.bankaccounts[i].Bank_Product__c);
      this.bankaccounts[i].Bank_Product__c = bankProduct.UpdatedId;
    }

    const results:any = await conn.insert('Bank_Account__c', this.bankaccounts)
    cmd.ux.log('Got results?');
    for (let i = 0; i < results.length; i++) {
      this.bankaccounts[i].UpdatedId = results[i].id;
    }
    fs.writeFileSync('importedBankAccounts.json', JSON.stringify(this.bankaccounts, null, 4));

  }

  protected excludeAccountsWithNoContacts() {
    //const accounts:Array<Account> = JSON.parse(fs.readFileSync('AccountData_GF.json', 'utf8').toString());
    //const contacts:Array<Contact> = JSON.parse(fs.readFileSync('ContactData_GF.json', 'utf8').toString());
    let accountsDeleted:number = 0;
    let accountsChecked:number = 0;
    const filteredAccounts:Array<Account> = new Array<Account>();
    for (let i=0; i<this.accounts.length; i++) {
      accountsChecked++;
      const account = this.accounts[i];
      const foundContact:Contact = this.contacts.find(contact => {
        return contact.AccountId === account.Id;
      })
      if (account != null && foundContact === undefined) {
        accountsDeleted++;
        delete this.accounts[i];
      } else {
        filteredAccounts.push(this.accounts[i]);
      }
    }
    this.ux.log(`Removed ${accountsDeleted} accounts since they have not contacts.`);
    this.ux.log(`Checked ${accountsChecked} accounts.`)
    this.accounts = filteredAccounts;
    //this.writeUpdatedDataFile('Account', this.accounts);
  }

  protected excludeContactsWithoutAnAccountInGoldFileX() {
    //this.contacts = JSON.parse(fs.readFileSync('ContactData_GF.json', 'utf8').toString());
    //this.loadAccountsFromFile();
    let contactsDeleted:number = 0;
    let contactsChecked:number = this.contacts.length;
    const filterdContacts:Array<Contact> = new Array<Contact>();
    for (let i:number = 0; i < this.contacts.length; i++ ) {
      const contact:Contact = this.contacts[i];
      const account:Account = this.accounts.find(acct => {
        if (acct === null) {
          return undefined;
        } else {
          return acct.Id === contact.AccountId;
        }
      });
      if (account === undefined) {
        contactsDeleted++;
         this.contacts.splice(i, 1);
         i--;
      } else {
        filterdContacts.push(this.contacts[i]);
      }
    }
    this.ux.log(`Removed ${contactsDeleted} contacts since they have no accounts in the extracted data.`);
    this.ux.log(`Checked ${contactsChecked} contacts.`)
    this.contacts = filterdContacts;
    //this.writeUpdatedDataFile('Contact', this.contacts);
  }

  protected excludeBankAccountsWithNoContactOrProduct() {
    //const bankaccounts:Array<Bank_Account> = JSON.parse(fs.readFileSync('BankAccountData_GF.json', 'utf8').toString());
    //const contacts:Array<Contact> = JSON.parse(fs.readFileSync('ContactData_GF.json', 'utf8').toString());
    //const bankproducts:Array<Bank_Product> = JSON.parse(fs.readFileSync('BankProductData_GF.json', 'utf8').toString());
    let bankAccountsDeleted:number = 0;
    let bankAccountsChecked:number = this.bankaccounts.length;
    const filteredBankAccounts: Array<Bank_Account> = new Array<Bank_Account>();
    for (let i=0; i<this.bankaccounts.length; i++) {
      const bankaccount = this.bankaccounts[i];
      const foundContact = this.contacts.find(d => d.Id === bankaccount.Contact__c);
      const foundProduct = this.bankproducts.find(d => d.Id === bankaccount.Bank_Product__c);
      if ( (bankaccount != null && foundContact === undefined) || (bankaccount != null && foundProduct === undefined) ) {
        bankAccountsDeleted++;
        delete this.bankaccounts[i];
      } else {
        filteredBankAccounts.push(this.bankaccounts[i]);
      }
    }
    if (bankAccountsDeleted > 0) {
      this.bankaccounts = filteredBankAccounts;
      this.ux.log(`Removed ${bankAccountsDeleted} bank accounts since they have no contacts.`);
      this.ux.log(`Checked ${bankAccountsChecked} bank accounts.`)
      //this.writeUpdatedDataFile('BankAccount', this.bankaccounts);
    }
  }
}
