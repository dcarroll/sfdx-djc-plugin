import * as _ from 'lodash';
import { join } from 'path';
import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import { isUndefined } from 'util';
import { DescribeSObjectResult, QueryResult } from 'jsforce';
import TohoomExtension from '../../../tohoom';
import { Connection, Messages, AuthInfo } from '@salesforce/core';
import { JsonMap } from '@salesforce/ts-types';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { ux } from '@oclif/core';

Messages.importMessagesDirectory(join(__dirname, '..', '..', '..'));
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

export type ExportResult = {
  message: string;
  data: JsonMap;
};

export default class Export extends SfCommand<ExportResult> {
  public static description = `Extract data from an org to use in a scratch org. Just supply a list of SObjects and you *should* end up with a dataset and data plan that can be used with the official force:data:tree:import command`; // messages.getMessage('commandDescription');

  public static examples = [
    `$ sfdx tohoom:data:export -o Account,Contact,Case,Opportunity -t data/exported -n my-testplan
  `
  ];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    // name: flags.string({char: 'n', description: messages.getMessage('nameFlagDescription')})
    objects: Flags.string({ required: true, char: 'o', description: 'Comma separated list of objects to fetch' }),
    planname: Flags.string({ default: 'new-data-plan', description: 'name of the data plan to produce, deflaults to "new-plan"', char: 'n'}),
    targetdir: Flags.string({ required: true, char: 't', description: 'target directoy to place results in'}),
    maxrecords: Flags.integer({ default: 10, char: 'm', description: 'Max number of records to return in any query'}),
    savedescribes: Flags.boolean({ char: 's', description: 'Save describe results (for diagnostics)'}),
    spiderreferences: Flags.boolean({ char: 'p', description: 'Include refereced SObjects determined by schema examination and existing data'}),
    enforcereferences: Flags.boolean({ char: 'e', description: 'If present, missing child reference cause the record to be deleted, otherwise, just the reference field is removed'}),
    preserveobjectorder: Flags.boolean({ char: 'b', description: 'If present, uses the order of the objects from the command to determine plan order'}),
    tohoom: Flags.boolean({ char: 'k', description: 'Special Tohoom processing to handle self referential relationship'})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  protected conn:Connection;
  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  private describeMap = {}; // Objectname describe result map
  private relMap: RelationshipMap; // map of object name and childRelationships and/or parents
  private objects: Array<string>;
  private dataMap = {};
  private planEntries: PlanEntry[];
  private globalIds: string[] = [] as string[];

  // tslint:disable-next-line:no-any 
  public async run(): Promise<any> {  
    const { flags } = await this.parse(Export);
    // We take in a set of object that we want to generate data for.  We will
    // examine the relationships of the included objects to one another to datermine
    // what to export and in what order.
    this.objects = flags.objects.split(','); // [ 'Account', 'Contact', 'Lead', 'Property__c', 'Broker__c'];
    // await this.newTest();
    // return;
    const authInfo = await AuthInfo.create({username: flags.username});
    this.conn = await Connection.create({ authInfo });
    // Create a map of object describes keyed on object name, based on
    // describe calls.  This should be cacheing the describe, at least
    // for development purposes.
    ux.log('Determining relationships for ' + this.objects.length + ' objects...');
    this.describeMap = await this.makeDescribeMap(this.objects, this.conn, flags);
    // Create a relationship map. A relationship map object is keyed on the
    // object name and has the following structure.
    // {
    //    parentRefs: Field[];
    //    childRefs: ChildRelationship[];
    // }
    this.relMap = this.makeRelationshipMap();

    // Run the queries and put the data into individual json files.
    await this.runCountQueries(this.conn);

    ux.log('Running queries for ' + _.keys(this.relMap).length + ' objects...');
    this.planEntries = await this.createDataPlan();
    await this.runQueries(this.conn, flags);
    ux.log('Saving data...');

    await this.saveData(flags);

    if (process.env.NODE_OPTIONS === '--inspect-brk' || flags.savedescribes ) {
      this.saveDescribeMap();
    }
    // return this.planEntries;
    if (flags.tohoom) {
      let ext = new TohoomExtension();
      ext.run(flags.planname, flags.targetdir, this);
    }
    ux.log('Finished exporting data and plan.');

  }

  private reorderPlan() {
    const newOrder: Array<PlanEntry> = [];
    //var pe: PlanEntry[];
    _.forEach(this.objects, (data, ind) => {
      const e = this.planEntries.find(element => element.sobject === data)
      if (e) {
        newOrder.push(e)
      }
    });
    this.planEntries = newOrder;
  }

  // Save data iterates over the in-memory data sets.  For each data set,
  // each record is examined and the referenceId returned from the query
  // is set to just the id, rather than a url. After the data sets have been
  // adjusted, the data is written to the file system at the location passed
  // on the --targetdir flag.
  private async saveData(flags) {
    // tslint:disable-next-line:forin
    for (let objName in this.dataMap) {
      objName = objName.split('.')[0];
      // tslint:disable-next-line:forin
      for (const ind in this.dataMap[objName].records) {
        const record = this.dataMap[objName].records[ind];
        if (!isUndefined(record.attributes)) {
          record.attributes['referenceId'] = record.Id;
        } else {
          this.dataMap[objName].records.splice(ind, 1);
        }
      }
      this.createRefs(this.dataMap[objName]);
    }

    this.pruneBadReferences(flags);
    if (!fs.existsSync(flags.targetdir)) {
      fsExtra.ensureDirSync(flags.targetdir);
    }
    // tslint:disable-next-line:forin
    for (let objName in this.dataMap) {
      objName = objName.split('.')[0];
      fs.writeFileSync(path.join(flags.targetdir, objName + '.json'), JSON.stringify(this.dataMap[objName], null, 4));
    }
    if (flags.preserveobjectorder) {
      this.reorderPlan();
    }
    fs.writeFileSync(path.join(flags.targetdir, flags.planname + '.json'), JSON.stringify(this.planEntries, null, 4));
  }

  private pruneBadReferences(flags) {
    _.forOwn(this.dataMap, (dataMapItem, key) => {
      // tslint:disable-next-line:no-any
      const records: Array<{}> = (dataMapItem as any).records;
      _.forEach(records, (record, index)  => {
        _.forOwn(record, (field: string, fieldName: string) => {
          if (fieldName !== 'attributes' && typeof field === 'string') {
            if (field.startsWith('@ref')) {
                if (!this.globalIds.includes(field.split('@ref')[1])) {
                  if (flags.enforcereferences) {
                    this.dataMap[key].records.splice(index, 1);
                  } else {
                    delete record[fieldName];
                  }
                }
              }
            }
        });
      });
    });
  }

  private async listGen(): Promise<Array<string>> {
    const listMap = {};
    for (const key in this.relMap) {
      const obj = this.relMap[key];
      // tslint:disable-next-line:forin
      for (const ind in obj.parentRefs) {
        const refTo = obj.parentRefs[ind].referenceTo;
        // tslint:disable-next-line:prefer-for-of
        for (let i = 0; i < refTo.length; i++) {
          const refToValue = refTo[i];
          //if (refToValue !== key && !isUndefined(this.relMap[refToValue])) {
            if (isUndefined(listMap[refTo[i]])) {
              listMap[refToValue] = [];
            }
            if (!listMap[refToValue].includes(key)) {
              listMap[refToValue].push(key);
            }
          }
        //}
      }
    }
    return await this.getDataPlanOrder(listMap);
  }

  private async getDataPlanOrder(listMap): Promise<Array<string>> {
    const tempList: Array<string>  = [];
    // tslint:disable-next-line:no-any
    // const listMap: any = await core.json.readJson('./planMapOriginal.json');
    // tslint:disable-next-line:forin
    for (const topLevelObject in listMap) {
      listMap[topLevelObject].forEach(child => {
        if (!tempList.includes(child)) {
          tempList.push(child);
        }
      });
      // Determine if this object is referenced by any other objext in our list
      const isObjRefResult = this.isObjectReferenced(topLevelObject, listMap);
      if (isObjRefResult.result) {
        // This object is referenced by another object so we need to insert it in the right place
        // What is the right place??? Not sure
        isObjRefResult.refrerencingObject.forEach(refObj => {
          if (!tempList.includes(refObj)) {
            // See if topLevelObject is in the list, if it is, we should create the refObj
            // just above the topLevel object
            if (tempList.includes(topLevelObject)) {
              tempList.splice(tempList.indexOf(topLevelObject), 0, refObj);
            } else {
              // Neither the topLevelObject nor the refObj are in the list
              tempList.unshift(refObj);
            }
          }
          const ind = tempList.indexOf(topLevelObject);
          // Add the top level just after the refObj if it's not already in the list
          if (ind === -1) {
            tempList.splice(tempList.indexOf(refObj) + 1, 0, topLevelObject);
          }
          // If the toplevel was already in the array, remove the orginal one indexed by 'ind'
          //if (ind !== -1) {
          //  tempList.splice(ind + 1, 1);
          //}
        });
      } else {
        if (!tempList.includes(topLevelObject)) {
          tempList.unshift(topLevelObject);
        }
      }
    }
    return tempList;
  }

  private isObjectReferenced(objectName, listMap) {
    // deepcode ignore ArrayConstructor: <please specify a reason of ignoring this>
    const result = { result: false, refrerencingObject: new Array() };
    for (const topLevelObject in listMap) {
      if (topLevelObject === objectName) {
        // Skip, this is the thing itself
      } else {
        // Loop over the the children of the object, if the child is the object we are checking
        // to see if it referenced, then we create a result object indicating that is in fact
        // reference by another object also make note of the object that references it
        listMap[topLevelObject].forEach(childElement => {
          if (childElement === objectName) {
            result.result = true;
            result.refrerencingObject.push(topLevelObject);
          }
        });
      }
    }
    return result;
  }

  private async createDataPlan(): Promise<PlanEntry[]> {
    const listPlan: Array<string> = await this.listGen();
    const planEntries: PlanEntry[] = [] as PlanEntry[];

    listPlan.forEach(key => {
      const obj: RelationshipMap = this.relMap[key];
      if (!isUndefined(obj)) {
        if (obj.childRefs !== undefined && obj.childRefs.length > 0) {
          // This is an object that has childRelationships, so should bubble up to the top of the plan
          planEntries.push(this.makeParentPlanEntry(key, obj));
        } else if (obj.parentRefs.length > 0) {
          planEntries.push(this.makePlanEntry(key, obj));
        }
      }
    });
    // tslint:disable-next-line:prefer-for-of
    for (let i: number = 0; i < planEntries.length; i++) {
        if (isUndefined(planEntries[i].resolveRefs)) {
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
        if (element[key] === null) {
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

  private async runQueries(connection: Connection, flags) {
    for (const sobjectName in this.relMap) {
      if (this.relMap.hasOwnProperty(sobjectName)) {
        if (_.findIndex(this.planEntries, [ 'sobject', sobjectName]) === -1) {
        // if (!_.has(this.planEntries, key)) {
          delete this.relMap[sobjectName];
          delete this.describeMap[sobjectName];
        } else {
          const rootObj = this.relMap[sobjectName];

          if (this._validRootObj(rootObj)) {
            // Run query and store in qrMap
            await connection.query(this.generateSimpleQuery(sobjectName, flags)).then(rootData => {
              rootData = this.removeNulls(rootData);
              if (rootData.totalSize > 0) {
                this.dataMap[sobjectName] = rootData;
                const ids = this.pullIds(this.dataMap[sobjectName]);

                // tslint:disable-next-line:forin
                for (const dependent in rootObj.childRefs) {
                  // Run query using ids from rootObj in where clause for dependent
                  const childSObject = rootObj.childRefs[dependent];
                  if (rootObj.name !== childSObject.childSObject && this.shouldQueryThisField(childSObject)) {
                    connection.query(this.generateDependentQuery(childSObject.childSObject, ids, childSObject.field, flags)).then(data => {
                      this.removeNulls(data);
                      if (data.totalSize > 0) {
                        this.addToDatamap(childSObject.childSObject, data);
                      }
                    }).catch((reason: any) => {
                      return reason;
                    });
                  }
                }
              } else {
                delete this.describeMap[sobjectName];
                delete this.relMap[sobjectName];
              }
            }).catch((reason: any) => {
              return reason;
            });
          } else if (isUndefined(rootObj.childRefs) && !isUndefined(rootObj.parentRefs)) {
            // Run query and add to map
            await connection.query(this.generateSimpleQuery(sobjectName, flags)).then(rootData => {
              rootData = this.removeNulls(rootData);
              if (rootData.totalSize > 0) {
                this.dataMap[sobjectName] = rootData;
                this.pullIds(this.dataMap[sobjectName]);
              }
            }).catch((reason: any) => {
              return reason;
            });
          } else {
            delete this.describeMap[sobjectName];
            delete this.relMap[sobjectName];
          }
        }
      }
    }
  }

  private async runCountQueries(connection: Connection) {
    for (const key in this.relMap) {
      if (this.relMap.hasOwnProperty(key)) {
        if (this._validRootObj(this.relMap[key])) {
          // Run query and store in qrMap
          await connection.query(this.generateSimpleCountQuery(key)).then(rootData => {
            if (rootData.totalSize === 0) {
              delete this.describeMap[key];
              delete this.relMap[key];
            }
          }).catch((reason: any) => {
            return reason;
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

  private generateSimpleQuery(objName, flags) {
    return this.generateQuery(objName) + ' Limit ' + flags.maxrecords;
  }

  private generateDependentQuery(objName: string, ids: string[], filterField: string, flags) {
    return this.generateQuery(objName) + ' Where ' + filterField + ' in (\'' + ids.join('\',\'') + '\') Limit ' + flags.maxrecords;
  }

  private generateQuery(objName) {
    const selectClause = new Array();
    // tslint:disable-next-line:forin
    for (const fieldIndex in this.describeMap[objName].fields) {
      const field = this.describeMap[objName].fields[fieldIndex];
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
        } else {
          _.set(relationshipMap, [value, 'childRefs'], []);
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
        if (this.describeMap[key].layoutable) {
          fs.writeFileSync('./describes/' + key + '.json', JSON.stringify(this.describeMap[key], null, 4));
        }
      }
    }
  }

  private async makeDescribeMap(objects, conn, flags) {
    const describeMap = {}; // Objectname describe result map
    for (const object of this.objects) {

      await this.getSobjectDescribe(object, conn).then(async describeResult => {
        if (describeResult.layoutable) {
          describeMap[object] = {
            fields: describeResult.fields,
            childRelationships: describeResult['childRelationships'],
            layoutable: describeResult.layoutable
          };

          if (flags.spiderreferences) {
            await this.spiderReferences(describeMap[object], describeMap, conn, object);
          }
        }
      }).catch((reason: any) => {
        return reason;
      });
    }
    return describeMap;
  }

  private async spiderReferences(describeResult: DescribeSObjectResult, describeMap, conn, object) {
    // tslint:disable-next-line:prefer-for-of
    for (let i = 0; i < describeResult.fields.length; i++) {
      const field: Field = describeResult.fields[i] as unknown as Field;
      if (field.referenceTo) {
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
            }).catch((reason: any) => {
              return reason;
            });
          }
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
