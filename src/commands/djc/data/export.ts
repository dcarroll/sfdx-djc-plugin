import * as _ from 'lodash';

import { core, SfdxCommand } from '@salesforce/command';

import { flags } from '@oclif/command';
import { join } from 'path';

import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import * as path from 'path';

import { isUndefined } from 'util';

import { Connection } from '@salesforce/core';
import { DescribeSObjectResult, QueryResult } from 'jsforce';

core.Messages.importMessagesDirectory(join(__dirname, '..', '..', '..'));
// const messages = core.Messages.loadMessages('data', 'export');
interface ChildRelationship {
  cascadeDelete: boolean;
  childSObject: string;
  deprecatedAndHidden: boolean;
  field: string;
  junctionIdListNames: string[];
  junctionReferenceTo: string[];
  relationshipName: string;
  restrictedDelete: boolean;
  fieldReferenceTo: string;
}

interface Field {
  custom: boolean;
  defaultValue?: string | boolean;
  // encrypted: boolean;
  externalId: boolean;
  // extraTypeInfo: string;
  filterable: boolean;
  idLookup: boolean;
  label: string;
  mask?: string;
  maskType?: string;
  name: string;
  nameField: boolean;
  namePointing: boolean;
  polymorphicForeignKey: boolean;
  referenceTargetField?: string;
  referenceTo?: string[];
  relationshipName?: string;
  relationshipOrder?: number;
  // tslint:disable-next-line:no-reserved-keywords
  type: string;
}

interface IDescribeSObjectResult {
  fields: Field[];
  childRelationships: ChildRelationship[];
  layoutable: boolean;
}

interface RelationshipMap {
  parentRefs: Field[];
  childRefs: ChildRelationship[];
}

interface PlanEntry {
  sobject: string;
  saveRefs: boolean;
  resolveRefs: boolean;
  files: string[];
}

export default class Export extends SfdxCommand {
  public static description = 'This is a proof of concept of a entirely differenct way to extract data from an org to use as developer data for a scratch org.  Just supply a list of SObject, standard or custom, and you *should* end up with a dataset and data plan that can be used with the official force:data:tree:import command'; // messages.getMessage('commandDescription');

  public static examples = [
    `$ sfdx djc:data:export -o Account,Contact,Case,Opportunity -t data/exported -n my-testplan
$ sfdx djc:data:export -o "Account, CustomObj__c, OtherCustomObj__c, Junction_Obj__c" - t data/exported
  `
  ];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    // name: flags.string({char: 'n', description: messages.getMessage('nameFlagDescription')})
    objects: flags.string({ required: true, char: 'o', description: 'Comma separated list of objects to fetch' }),
    planname: flags.string({ default: 'new-plan', description: 'name of the data plan to produce, deflaults to "new-plan"', char: 'n'}),
    targetdir: flags.string({ required: true, char: 't', description: 'target directoy to place results in'}),
    maxrecords: flags.integer({ default: 10, char: 'm', description: 'Max number of records to return in any query'}),
    savedescribes: flags.boolean({ char: 's', description: 'Save describe results (for diagnostics)'}),
    spiderreferences: flags.boolean({ char: 'p', description: 'Include refereced SObjects determined by schema examination and existing data'}),
    enforcereferences: flags.boolean({ char: 'e', description: 'If present, missing child reference cause the record to be deleted, otherwise, just the reference field is removed'})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  private describeMap = {}; // Objectname describe result map
  private relMap: RelationshipMap; // map of object name and childRelationships and/or parents
  private objects: string[];
  private dataMap = {};
  private planEntries: PlanEntry[];
  private globalIds: string[] = [] as string[];

  // tslint:disable-next-line:no-any
  public async run(): Promise<any> {
    // We take in a set of object that we want to generate data for.  We will
    // examine the relationships of the included objects to one another to datermine
    // what to export and in what order.
    this.objects = this.flags.objects.split(','); // [ 'Account', 'Contact', 'Lead', 'Property__c', 'Broker__c'];

    const conn = this.org.getConnection();
    // Create a map of object describes keyed on object name, based on
    // describe calls.  This should be cacheing the describe, at least
    // for development purposes.
    this.ux.startSpinner('Determining relationships for ' + this.objects.length + ' objects...');
    this.describeMap = await this.makeDescribeMap(this.objects, conn);
    this.ux.stopSpinner('');
    // Create a relationship map. A relationship map object is keyed on the
    // object name and has the following structure.
    // {
    //    parentRefs: Field[];
    //    childRefs: ChildRelationship[];
    // }
    this.relMap = this.makeRelationshipMap();

    // Run the queries and put the data into individual json files.
    await this.runCountQueries(conn);

    this.ux.startSpinner('Running queries for ' + _.keys(this.relMap).length + ' objects...');
    await this.runQueries(this.org.getConnection());
    this.ux.stopSpinner('Saving data...');

    this.planEntries = this.createDataPlan();
    await this.saveData();

    if (process.env.NODE_OPTIONS === '--inspect-brk' || this.flags.savedescribes ) {
      this.saveDescribeMap();
    }
    this.ux.log('Finished exporting data and plan.');
    // return this.planEntries;
  }

  // Save data iterates over the in-memory data sets.  For each data set,
  // each record is examined and the referenceId returned from the query
  // is set to just the id, rather than a url. After the data sets have been
  // adjusted, the data is written to the file system at the location passed
  // on the --targetdir flag.
  private async saveData() {
    // tslint:disable-next-line:forin
    for (let objName in this.dataMap) {
      objName = objName.split('.')[0];
      // tslint:disable-next-line:forin
      for (const ind in this.dataMap[objName].records) {
        const record = this.dataMap[objName].records[ind];
        if (!isUndefined(record.attributes)) {
          record.attributes['referenceId'] = record.Id;
          // output.records.push(record);
        } else {
          this.dataMap[objName].records.splice(ind, 1);
        }
      }
      this.createRefs(this.dataMap[objName]);
    }

    this.pruneBadReferences();
    if (!fs.existsSync(this.flags.targetdir)) {
      fsExtra.ensureDirSync(this.flags.targetdir);
    }
    // tslint:disable-next-line:forin
    for (let objName in this.dataMap) {
      objName = objName.split('.')[0];
      fs.writeFileSync(path.join(this.flags.targetdir, objName + '.json'), JSON.stringify(this.dataMap[objName], null, 4));
    }
    fs.writeFileSync(path.join(this.flags.targetdir, 'new-data-plan.json'), JSON.stringify(this.planEntries, null, 4));
  }

  private pruneBadReferences() {
    for (const key in this.dataMap) {
      if (this.dataMap.hasOwnProperty(key)) {
        const records: Array<{}> = this.dataMap[key].records;
        for (let i = 0; i < records.length; i++) {
          const record = records[i];
          for (const fieldName in record) {
            if (fieldName !== 'attributes' && record.hasOwnProperty(fieldName)) {
              const value: string = record[fieldName].toString();
              if (value.startsWith('@ref')) {
                if (!this.globalIds.includes(value.split('@ref')[1])) {
                  if (this.flags.enforcereferences) {
                    this.dataMap[key].records.splice(i--, 1);
                  } else {
                    delete record[fieldName];
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  private createDataPlan(): PlanEntry[] {
    const planEntries: PlanEntry[] = [] as PlanEntry[];
    // tslint:disable-next-line:forin
    for (const key in this.dataMap) {
      const obj: RelationshipMap = this.relMap[key];
      if (!isUndefined(obj)) {
        if (obj.childRefs !== undefined && obj.childRefs.length > 0) {
          // This is an object that has childRelationships, so should bubble up to the top of the plan
          planEntries.push(this.makeParentPlanEntry(key, obj));
        } else if (obj.parentRefs.length > 0) {
          planEntries.push(this.makePlanEntry(key, obj));
        }
      }
    }
    // tslint:disable-next-line:prefer-for-of
    for (let i: number = 0; i < planEntries.length; i++) {
        const entry = planEntries[i];
        if (isUndefined(entry.resolveRefs)) {
          const ent = planEntries.splice(i, 1);
          planEntries.unshift(ent[0]);
        }
    }
    return planEntries;
  }

  private makePlanEntry(sObjectName: string, obj: RelationshipMap): PlanEntry {
    const planEntry: PlanEntry = {} as PlanEntry;
    planEntry.sobject = sObjectName;
    planEntry.resolveRefs = true;
    planEntry.files = [];
    planEntry.files.push(sObjectName + '.json');
    return planEntry;
  }

  private makeParentPlanEntry(sObjectName: string, obj: RelationshipMap): PlanEntry {
    const planEntry: PlanEntry = {} as PlanEntry;
    planEntry.sobject = sObjectName;
    planEntry.saveRefs = true;
    if (obj.parentRefs !== undefined && obj.parentRefs.length > 0) {
      planEntry.resolveRefs = true;
    }
    planEntry.files = [];
    planEntry.files.push(sObjectName + '.json');
    return planEntry;
  }

  // tslint:disable-next-line:no-any
  private createRefs(data: any) {
    const idMap = {};
    const regex = /[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18}/;
    data.records.forEach(element => {
      // tslint:disable-next-line:forin
      for (const key in element) {
        const value = element[key] + '';
        if ((value.length === 18 || value.length === 15) && value.match(regex)) {
          if (key === 'OwnerId') {
            delete element[key];
          } else {
            if (idMap.hasOwnProperty(value)) {
              element[key] = idMap[value]['ref'];
            } else {
              idMap[value] = { key, ref: '@ref' + value };
              element[key] = '@ref' + value;
            }
            if (key === 'Id') {
              element['attributes']['referenceId'] = 'ref' + value;
              delete element['attributes']['url'];
              delete element[key];
            }
          }
        }
      }
    });
  }

  private removeNulls(rootData) {
    rootData.records.forEach(element => {
      // tslint:disable-next-line:forin
      for (const key in element) {
        const field = element[key];
        if (field === null) {
          delete element[key];
        }
      }
    });
    return rootData;
  }

  private shouldQueryThisField(childSObject): boolean {
    return !isUndefined(childSObject.relationshipName) && !isUndefined(this.relMap[childSObject.childSObject]);
  }

  private _validRootObj(rootObj): boolean {
    if (!isUndefined(rootObj)) {
      if (!isUndefined(rootObj.childRefs)) {
        return true;
      }
    }
    return false;
  }

  private async runQueries(connection: Connection) {
    for (const key in this.relMap) {
      if (this.relMap.hasOwnProperty(key)) {
        const rootObj = this.relMap[key];

        if (this._validRootObj(rootObj)) {
          // Run query and store in qrMap
          await connection.query(this.generateSimpleQuery(key)).then(rootData => {
            rootData = this.removeNulls(rootData);
            if (rootData.totalSize > 0) {
              this.dataMap[key] = rootData;
              const ids = this.pullIds(this.dataMap[key]);

              // tslint:disable-next-line:forin
              for (const dependent in rootObj.childRefs) {
                // Run query using ids from rootObj in where clause for dependent
                const childSObject = rootObj.childRefs[dependent];
                if (rootObj.name !== childSObject.childSObject && this.shouldQueryThisField(childSObject)) {
                  const dependentSoql = this.generateDependentQuery(childSObject.childSObject, ids, childSObject.field);

                  connection.query(dependentSoql).then(data => {
                    this.removeNulls(data);
                    if (data.totalSize > 0) {
                      this.addToDatamap(childSObject.childSObject, data);
                    }
                  });
                }
              }
            } else {
              delete this.describeMap[key];
              delete this.relMap[key];
            }
          });
        } else if (isUndefined(rootObj.childRefs) && !isUndefined(rootObj.parentRefs)) {
          // Run query and add to map
          await connection.query(this.generateSimpleQuery(key)).then(rootData => {
            rootData = this.removeNulls(rootData);
            if (rootData.totalSize > 0) {
              this.dataMap[key] = rootData;
              this.pullIds(this.dataMap[key]);
            }
          });
        } else {
          delete this.describeMap[key];
          delete this.relMap[key];
        }
      }
    }
  }

  private async runCountQueries(connection: Connection) {
    for (const key in this.relMap) {
      if (this.relMap.hasOwnProperty(key)) {
        const rootObj = this.relMap[key];

        if (this._validRootObj(rootObj)) {
          // Run query and store in qrMap
          const rootData = await connection.query(this.generateSimpleCountQuery(key)).then(rootData => {
            if (rootData.totalSize === 0) {
              delete this.describeMap[key];
              delete this.relMap[key];
            }
          });
        } else {
          delete this.describeMap[key];
          delete this.relMap[key];
        }
      }
    }
  }

  private addToDatamap(dataMapIndex: string, dependentData: QueryResult<{}>) {
    if (this.dataMap.hasOwnProperty(dataMapIndex)) {
      // remove duplicates and add to map
      const newRecords = this.removeDuplicates(this.dataMap[dataMapIndex], dependentData);
      this.dataMap[dataMapIndex].records.concat(newRecords.records);
    } else {
      this.dataMap[dataMapIndex] = dependentData;
    }
  }

  private removeDuplicates(mapData: QueryResult<{}>, newData: QueryResult<{}>): QueryResult<{}> {
    mapData.records.forEach(element => {
      const foundIndex = _.findIndex(newData.records, ['Id', element['Id']]);
      if ( foundIndex !== -1) {
        newData.records.splice(foundIndex, 1);
        newData.totalSize = newData.totalSize - 1;
      }
    });
    return newData;
  }

  private pullIds(data) {
    const ids: string[] = [];
    // tslint:disable-next-line:forin
    for (const ind in data.records) {
      ids.push(data.records[ind].Id);
      this.globalIds.push(data.records[ind].Id);
    }
    return ids;
  }

  private generateSimpleCountQuery(objName) {
    return 'Select Count() From ' + objName;
  }

  private generateSimpleQuery(objName) {
    const soql = this.generateQuery(objName);
    return soql + ' Limit ' + this.flags.maxrecords;
  }

  private generateDependentQuery(objName: string, ids: string[], filterField: string) {
    const soql: string = this.generateQuery(objName);
    return soql + ' Where ' + filterField + ' in (\'' + ids.join('\',\'') + '\') Limit ' + this.flags.maxrecords;
  }

  private generateQuery(objName) {
    const objDescribe = this.describeMap[objName];
    const fields = objDescribe.fields;
    const selectClause = [];
    // tslint:disable-next-line:forin
    for (const fieldIndex in fields) {
      const field = fields[fieldIndex];
      if (field.createable) {
        selectClause.push(field.name);
      }
    }
    selectClause.push('Id');

    return 'Select ' + selectClause.join(',') + ' From ' + objName;
  }

  private getObjectChildRelationships(): RelationshipMap {
    const relationshipMap = {};
    // Iterate over the describeMap to visit each object describe
    for (const value in this.describeMap) {
      if (!isUndefined(value)) {
        let index = 0;
        for (const child of this.describeMap[value].childRelationships) {
          if (!isUndefined(this.describeMap[child.childSObject]) && this.describeMap[child.childSObject].layoutable) {
            _.set(relationshipMap, [value, 'childRefs', index], child);
            index++;
          }
        }
        if (!isUndefined(relationshipMap[value])) {
          _.set(relationshipMap, [value, 'name'], value);
        }
      }
    }
    return relationshipMap as RelationshipMap;
  }

  private getObjectParentRelationships(): RelationshipMap {
    const relationshipMap = {};
    // tslint:disable-next-line:no-any
    _.map(this.describeMap, (value: any, key) => {
      let relIndex = 0;
      _.forEach(value.fields, field => {
        if (field.type === 'reference') {
          // tslint:disable-next-line:prefer-for-of
          for (let i = 0; i < field.referenceTo.length; i++ ) {
            if (!isUndefined(this.describeMap[field.referenceTo[i]])) {
              _.set(relationshipMap, [key, 'parentRefs', relIndex++], field);
            }
          }
        }
      });
      if (relationshipMap[key]) {
        _.remove(relationshipMap[key]['parentRefs'], n => {
          return _.isUndefined(n);
        });
      }
      if (!isUndefined(relationshipMap[key])) {
        _.set(relationshipMap, [key, 'name'], key);
      }
    });
    return relationshipMap as RelationshipMap;
  }

  private async getSobjectDescribe(objName: string, conn): Promise<IDescribeSObjectResult> {
    let describeResult: IDescribeSObjectResult;
    if (fs.existsSync('./describes/' + objName + '.json')) {
      describeResult = JSON.parse(fs.readFileSync('./describes/' + objName + '.json').toString());
    } else {
      describeResult = await conn.describe(objName);
    }
    return describeResult;
  }

  private saveDescribeMap() {
    if (!fs.existsSync('./describes')) {
      fs.mkdirSync('./describes');
    }
    for (const key in this.describeMap) {
      if (this.describeMap.hasOwnProperty(key)) {
        const describeResult = this.describeMap[key];
        if (describeResult.layoutable) {
          fs.writeFileSync('./describes/' + key + '.json', JSON.stringify(describeResult, null, 4));
        }
      }
    }
  }

  private async makeDescribeMap(objects, conn) {
    const describeMap = {}; // Objectname describe result map
    for (const object of this.objects) {

      await this.getSobjectDescribe(object, conn).then(async describeResult => {
        if (describeResult.layoutable) {
          describeMap[object] = {
            fields: describeResult.fields,
            childRelationships: describeResult['childRelationships'],
            layoutable: describeResult.layoutable
          };

          if (this.flags.spiderreferences) {
            await this.spiderReferences(describeMap[object], describeMap, conn);
          }
        }
      });
    }
    return describeMap;
  }

  private async spiderReferences(describeResult: DescribeSObjectResult, describeMap, conn) {
    // tslint:disable-next-line:prefer-for-of
    for (let i = 0; i < describeResult.fields.length; i++) {
      const field: Field = describeResult.fields[i];
      if (field.type === 'reference' && !field.referenceTo.includes('User')) {
        // tslint:disable-next-line:prefer-for-of
        for (let index = 0; index < field.referenceTo.length; index++) {
          const objectReference = field.referenceTo[index];
          if (isUndefined(describeMap[objectReference])) {
            await this.getSobjectDescribe(objectReference, conn).then(describeSObjectResult => {
              if (describeSObjectResult.layoutable) {
                // this.objects.push(objectReference);
                describeMap[objectReference] = {
                  fields: describeSObjectResult.fields,
                  childRelationships: describeSObjectResult['childRelationships'],
                  layoutable: describeSObjectResult.layoutable
                };
              }
            });
          }
        }
      }
    }
  }

  private makeRelationshipMap() {
    const relationshipMap: RelationshipMap = {} as RelationshipMap;
    _.merge(relationshipMap,
            this.getObjectChildRelationships(),
            this.getObjectParentRelationships());

    return relationshipMap;
  }
}
