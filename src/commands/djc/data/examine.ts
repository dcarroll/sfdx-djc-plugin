import * as _ from 'lodash';

import { core, SfdxCommand } from '@salesforce/command';

import { flags } from '@oclif/command';
import { join } from 'path';

import * as fs from 'fs';
import * as path from 'path';

import { isString, isUndefined } from 'util';

import { Connection, JsonMap } from '@salesforce/core';
import * as he from 'he';
import { QueryResult } from 'jsforce';

core.Messages.importMessagesDirectory(join(__dirname, '..', '..', '..'));
// const messages = core.Messages.loadMessages('data', 'examine');
interface ChildRelationship {
  cascadeDelete: boolean;
  childSObject: string;
  deprecatedAndHidden: boolean;
  field: string;
  junctionIdListNames: string[];
  junctionReferenceTo: string[];
  relationshipName: string;
  restrictedDelete: boolean;
}

interface Field {
  createable: boolean;
  custom: boolean;
  defaultValue: string;
  encrypted: boolean;
  externalId: boolean;
  extraTypeInfo: string;
  filterable: boolean;
  idLookup: boolean;
  label: string;
  mask: string;
  maskType: string;
  name: string;
  nameField: boolean;
  namePointing: boolean;
  polymorphicForeignKey: boolean;
  referenceTargetField: string;
  referenceTo: string[];
  relationshipName: string;
  relationshipOrder: string;
  // tslint:disable-next-line:no-reserved-keywords
  type: string;
}

interface IDescribeSObjectResult {
  fields: Field[];
  childRelationships: ChildRelationship[];
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

export default class Examine extends SfdxCommand {
  public static description = 'Test data export'; // messages.getMessage('commandDescription');

  public static examples = [
    `$ sfdx data:examine -o Account,Contact,Case,Opportunity -t data/exported
  `
  ];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    // name: flags.string({char: 'n', description: messages.getMessage('nameFlagDescription')})
    objects: flags.string({ required: true, char: 'o', description: 'Comma separated list of objects to fetch' }),
    targetdir: flags.string({ required: true, char: 't', description: 'target directoy to place results in'}),
    maxrecords: flags.integer({ default: 10, char: 'm', description: 'Max number of records to return in any query'})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  private describeMap = {}; // Objectname describe result map
  private relMap: RelationshipMap; // map of object name and children and/or parents
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
    this.describeMap = await this.makeDescribeMap(this.objects, conn);

    // Create a relationship map. A relationship map object is keyed on the
    // object name and has the following structure.
    // {
    //    parentRefs: Field[];
    //    childRefs: ChildRelationship[];
    // }
    this.relMap = this.makeRelationshipMap(this.objects);

    // Create the query map, a heirachical set of queries to make,
    // the actual soql criteria is an "in" clause using the ideas from
    // the previous queries.

    // Run the queries and put the data into individual json files.
    // await this.runQueries();
    await this.runQueries(this.org.getConnection());

    this.planEntries = this.createDataPlan();

    await this.saveData();

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
        // records.forEach(record => {
        // tslint:disable-next-line:prefer-for-of
        for (let i = 0; i < records.length; i++) {
          const record = records[i];
          for (const fieldName in record) {
            if (fieldName !== 'attributes' && record.hasOwnProperty(fieldName)) {
              const value: string = record[fieldName].toString();
              if (value.startsWith('@ref')) {
                if (!this.globalIds.includes(value.split('@ref')[1])) {
                  // tslint:disable-next-line:no-delete-expression
                  this.dataMap[key].records.splice(i--, 1);
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
    for (const ind in this.objects) {
    // for (const key in this.relMap) {
      const key = this.objects[ind];
      const obj: RelationshipMap = this.relMap[key];
      if (obj.childRefs !== undefined && obj.childRefs.length > 0) {
        // This is an object that has children, so should bubble up to the top of the plan
        planEntries.push(this.makeParentPlanEntry(key, obj));
      } else if (obj.parentRefs.length > 0) {
        planEntries.push(this.makePlanEntry(key, obj));
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
        } else {
          if (isString(field)) {
            element[key] = he.decode(field);
          }
        }
      }
    });
    return rootData;
  }

  private async runQueries(connection: Connection) {
    // tslint:disable-next-line:forin
    for (const index in this.objects) {
      const ind = this.objects[index];
      const rootObj = this.relMap[ind];
      if (!isUndefined(rootObj.childRefs)) {
        // Run query and store in qrMap
        const soql = await this.generateSimpleQuery(ind);
        let rootData = await connection.query(soql);
        rootData = this.removeNulls(rootData);

        if (rootData.totalSize > 0) {
          this.dataMap[ind] = rootData;
        }

        const ids = this.pullIds(this.dataMap[ind]);

        // tslint:disable-next-line:forin
        for (const dependent in rootObj.childRefs) {
          // Run query using ids from rootObj in where clause for dependent
          const childSObject = rootObj.childRefs[dependent];
          if (rootObj.name !== childSObject.childSObject) {
            const dependentSoql = await this.generateDependentQuery(childSObject.childSObject, ids, childSObject.field);
            const dataMapIndex = childSObject.childSObject; // + '.' + childSObject.field;
            let dependentData = await connection.query(dependentSoql);
            dependentData = this.removeNulls(dependentData);
            if (dependentData.totalSize > 0) {
              this.addToDatamap(dataMapIndex, dependentData);
              // this.dataMap[dataMapIndex] = dependentData;
            }
          }
        }
      } else if (isUndefined(rootObj.childRefs) && !isUndefined(rootObj.parentRefs)) {
        const soql = await this.generateSimpleQuery(ind);
        let rootData = await connection.query(soql);
        rootData = this.removeNulls(rootData);

        if (rootData.totalSize > 0) {
          this.dataMap[ind] = rootData;
        }

        const ids = this.pullIds(this.dataMap[ind]);
      }
    }
  }

  private addToDatamap(dataMapIndex: string, dependentData: QueryResult<{}>) {
    if (this.dataMap.hasOwnProperty(dataMapIndex)) {
      // remove duplicates and add to map
      const newRecords = this.removeDuplicates(this.dataMap[dataMapIndex], dependentData);
      this.dataMap[dataMapIndex].records.push(newRecords.records);
    } else {
      this.dataMap[dataMapIndex] = dependentData;
    }
  }

  private removeDuplicates(mapData: QueryResult<{}>, newData: QueryResult<{}>): QueryResult<{}> {
    mapData.records.forEach(element => {
      const foundIndex = _.findIndex(newData.records, ['Id', element['Id']]);
      if ( foundIndex !== -1) {
        delete newData.records[foundIndex];
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

  private async generateSimpleQuery(objName) {
    const soql = await this.generateQuery(objName);
    return soql + ' Limit ' + this.flags.maxrecords;
  }

  private async generateDependentQuery(objName: string, ids: string[], filterField: string) {
    const soql: string = await this.generateQuery(objName);
    return soql + ' Where ' + filterField + ' in (\'' + ids.join('\',\'') + '\') Limit ' + this.flags.maxrecords;
  }

  private async generateQuery(objName) {
    // tslint:disable-next-line:forin
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

  private getObjectChildRelationships(objects): RelationshipMap {
    const relationshipMap = {};
    for (const value in this.describeMap) {
      if (!isUndefined(value)) {
        let index = 1;
        for (const child of this.describeMap[value].children) {
          if (objects.indexOf(child.childSObject) !== -1) {
            _.set(relationshipMap, [value, 'childRefs', index], child);
            index++;
          }
        }
        if (relationshipMap[value]) {
          _.remove(relationshipMap[value]['childRefs'], n => {
            return _.isUndefined(n);
          });
        }
        if (!isUndefined(relationshipMap[value])) {
          _.set(relationshipMap, [value, 'name'], value);
        }
      }
    }
    return relationshipMap as RelationshipMap;
  }

  private getObjectParentRelationships(objects): RelationshipMap {
    const relationshipMap = {};
    // tslint:disable-next-line:no-any
    _.map(this.describeMap, (value: any, key, collection) => {
      let relIndex = 0;
      _.forEach(value.fields, (field, index, fields) => {
        if (field.type === 'reference') {
          // tslint:disable-next-line:prefer-for-of
          for (let i = 0; i < field.referenceTo.length; i++ ) {
            if (_.indexOf(objects, field.referenceTo[i]) !== -1) {
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

  private async makeDescribeMap(objects, conn) {
    const describeMap = {}; // Objectname describe result map
    for (const object of this.objects) {
      let describeResult: IDescribeSObjectResult;
      if (!fs.existsSync('./describes')) {
        fs.mkdirSync('./describes');
      }
      if (fs.existsSync('./describes/' + object + '.json')) {
        describeResult = JSON.parse(fs.readFileSync('./describes/' + object + '.json').toString());
      } else {
        describeResult = await conn.describe(object);
        fs.writeFileSync('./describes/' + object + '.json', JSON.stringify(describeResult, null, 4));
      }
      describeMap[object] = {
        fields: describeResult.fields,
        children: describeResult['childRelationships']
      };
    }
    return describeMap;
  }

  private makeRelationshipMap(objects) {
    const relationshipMap: RelationshipMap = {} as RelationshipMap;
    _.merge(relationshipMap,
            this.getObjectChildRelationships(objects),
            this.getObjectParentRelationships(objects));

    return relationshipMap;
  }
}
