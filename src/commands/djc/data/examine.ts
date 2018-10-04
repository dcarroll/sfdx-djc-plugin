import * as _ from 'lodash';

import { core, SfdxCommand } from '@salesforce/command';

import { flags } from '@oclif/command';
import { join } from 'path';

import * as fs from 'fs';
import * as path from 'path';

import { isString, isUndefined } from 'util';

import { Connection, JsonMap } from '@salesforce/core';
import * as he from 'he';

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
    targetdir: flags.string({ required: true, char: 't', description: 'target directoy to place results in'})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;
  private listOfChildren = []; // List of object names that are children of other objects
  private listOfParents = [];  // List of object names that are referenced by Id from other objects
  private describeMap = {}; // Objectname describe result map
  private relMap: RelationshipMap; // map of object name and children and/or parents
  private objects: string[];
  private dataMap = {};

  // tslint:disable-next-line:no-any
  public async run(): Promise<any> {

    // We take in a set of object that we want to generate data for.  We will
    // examine the relationships of the included objects to one another to datermine
    // what to export and in what order.
    // tslint:disable-line:no-any
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
    // queryMap = this.createQueryMap(this.relMap);

    // this.ux.logJson(this.queryMap);

    // _.forEach(this.objects, (obj) => {
    //   if (this.isRootLevel(obj, this.queryMap)) {
    //     this.ux.log(obj, ' is root level object');
    //   }
    // });

    // Run the queries and put the data into individual json files.
    // await this.runQueries();
    await this.testqueries(this.org.getConnection());

    await this.saveData();

    return this.relMap;
  }

  private async saveData() {
    const datasets = {};
    // tslint:disable-next-line:forin
    for (let objName in this.dataMap) {
      // Normalize object name, we are going to flatten all data into type files
      if (objName.indexOf('.') !== -1) {
        objName = objName.split('.')[0];
      }
      if (isUndefined(datasets[objName])) {
        datasets[objName] = {};
      }
      const dataset = datasets[objName];

      // Add each record to a new container for the object type
      // tslint:disable-next-line:forin
      for (const index in this.dataMap[objName].records) {
        const record = this.dataMap[objName].records[index];
        record.attributes['referenceId'] = record.Id;
        dataset[record.Id] = record;
      }
    }

    // tslint:disable-next-line:forin
    for (const objName in datasets) {
      if (!fs.existsSync(this.flags.targetdir)) {
        fs.mkdirSync(this.flags.targetdir);
      } else {
        if (fs.existsSync(path.join(this.flags.targetdir, objName))) {
          fs.rmdirSync(path.join(this.flags.targetdir, objName));
        }
        // fs.mkdirSync('./data');
      }
      const output = { records: [] };
      // tslint:disable-next-line:forin
      for (const ind in datasets[objName]) {
        output.records.push(datasets[objName][ind]);
      }
      this.stashIds(output);
      fs.writeFileSync(path.join(this.flags.targetdir, objName + '.json'), JSON.stringify(output, null, 4));
    }
    console.log('Done');
  }

  /*private mergeFiles() {
    this.ux.log('Running merge');
    const results = fs.readdirSync('./queryresults');
    // tslint:disable-next-line:prefer-for-of
    for (let y = 0; y < this.objects.length; y++) {
    // _.forEach(this.objects, (obj) => {
      const obj = this.objects[y];
      const mergeCandidates: object[] = [];
      // tslint:disable-next-line:prefer-for-of
      for (let i = 0; i < results.length; i++) {
        const fileName = results[i];
        const fileNameLeft = fileName.split('.')[0];
        if (fileNameLeft === obj) {
          if (!_.isUndefined(this.didQuery[fileNameLeft])) {
            mergeCandidates.push(
              { records: this.didQuery[fileNameLeft]['records'],
                file: fileName
              }
          );
          }
        }
      }
      if (mergeCandidates.length > 1) {
        const merged = _.union(mergeCandidates);
        // tslint:disable-next-line:prefer-for-of
        // for (let x = 0; x < mergeCandidates.length; x++) {
        //  fs.unlinkSync(path.join(process.cwd(), 'queryresults', mergeCandidates[x]['file']));
        // }
        // fs.writeFileSync('./queryresults/' + obj + '.json', JSON.stringify(merged, null, 4));
      }
    }
  }*/

  // Not used
  private saveQueryResults(objName, qr) {
    fs.writeFileSync('./queryresults/' + objName + '.json', JSON.stringify(qr, null, 4));
  }

  // tslint:disable-next-line:no-any
  private stashIds(data: any) {
    const idMap = {};
    const regex = /[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18}/;
    data.records.forEach(element => {
      for (const key in element) {
        if (element.hasOwnProperty(key)) {
          const value = element[key] + '';
          if (value.match(regex)) {
            if (key === 'OwnerId') {
              delete element[key];
            } else {
              if (idMap.hasOwnProperty(value)) {
                element[key] = idMap['ref'];
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
      }
    });
    // this.ux.log(JSON.stringify(idMap, null, 4));
  }

  private removeNulls(rootData) {
    rootData.records.forEach(element => {
      for (const key in element) {
        if (element.hasOwnProperty(key)) {
          const field = element[key];
          if (field === null) {
            delete element[key];
          } else {
            if (isString(field)) {
              element[key] = he.decode(field);
            }
          }
        }
      }
    });
    return rootData;
  }

  private async testqueries(connection: Connection) {
    // tslint:disable-next-line:forin
    for (const ind in this.relMap) {
      const rootObj = this.relMap[ind];
      // Run query and store in qrMap
      const soql = await this.generateSimpleQuery(ind);
      console.log('\nQuery root object: ' + ind + '\n' + soql);
      let rootData = await connection.query(soql);
      rootData = this.removeNulls(rootData);
      // this.stashIds(rootData);
      if (rootData.totalSize > 0) {
        this.dataMap[ind] = rootData;
      }
      // console.log(JSON.stringify(data, null, 4));
      const ids = this.pullIds(this.dataMap[ind]);
      // tslint:disable-next-line:forin
      for (const dependent in rootObj.childRefs) {
        // Run query using ids from rootObj in where clause for dependent
        const childSObject = rootObj.childRefs[dependent];
        if (rootObj.name !== childSObject.childSObject) {
          console.log('\tQuery dependent object: ' + childSObject.childSObject);
          const dependentSoql = await this.generateDependentQuery(childSObject.childSObject, ids, childSObject.field);
          console.log('\tSOQL: \n\t' + dependentSoql);
          const dataMapIndex = childSObject.childSObject + '.' + childSObject.field;
          const dependentData = await connection.query(dependentSoql);
          if (dependentData.totalSize > 0) {
            this.dataMap[dataMapIndex] = await connection.query(dependentSoql);
            console.log('here');
          }
        }
      }
    }
  }

  private pullIds(data) {
    const ids: string[] = [];
    // tslint:disable-next-line:forin
    for (const ind in data.records) {
      ids.push(data.records[ind].Id);
    }
    return ids;
  }

  private async generateSimpleQuery(objName) {
    const soql = await this.generateQuery(objName);
    return soql + ' Limit 50';
  }

  private async generateDependentQuery(objName: string, ids: string[], filterField: string) {
    const soql: string = await this.generateQuery(objName);
    return soql + ' Where ' + filterField + ' in (\'' + ids.join('\',\'') + '\') Limit 50';
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

  // tslint:disable-next-line:no-any
  /* private async runQueries() {
    // tslint:disable-next-line:forin
    for (const ind in this.queryMap) {
      const rootObj = this.queryMap[ind];

      if (_.isUndefined(this.didQuery[ind])) {
        this.ux.log('Ok, will query the ' + ind + ' object...');
        // let qr;
        if (!fs.existsSync('./queryresults')) {
          fs.mkdirSync('./queryresults');
        }
        if (fs.existsSync('./queryresults/' + ind + '.json')) {
          this.didQuery[ind] = JSON.parse(fs.readFileSync('./queryresults/' + ind + '.json').toString());
        } else {
          const soql = this.generateSOQL(ind) + ' LIMIT 10';
          const qrx = await this.org.getConnection().query(soql);
          this.ux.log('Got parent query data...');
          fs.writeFileSync('./queryresults/' + ind + '.json', JSON.stringify(this.stripNullsFromQueryResult(qrx), null, 4));
          this.didQuery[ind] = qrx;
          _.forEach(rootObj.children, async (child, i) => {
              if (_.isUndefined(this.didQuery[this.getObjectFromName(child)])) {
                let qr = await this.getRelatedRecords(this.didQuery[ind], child);
                if (qr.totalSize > 0) {
                qr = this.stripNullsFromQueryResult(qr);
                this.ux.log('\tQuerying ', child, ' using ', ind, ' for set of ids to limit query to parent...');
                this.didQuery[child] = qr;
                fs.writeFileSync('./queryresults/' + child + '.json', JSON.stringify(qr, null, 4));
                }
              } else {
                this.ux.log('\tGetting ids for ', child, ' from previous query...');
                this.didQuery[child] = JSON.parse(fs.readFileSync('./queryresults/' + this.getObjectFromName(child) + '.json').toString());
              }
            });
      }
    } else {
        this.ux.log('Getting ids for ', ind, ' from previous query...');
    }
    }
  }*/

  /*private getRelatedRecords(qr, relatedField) {
    const childObject = relatedField.split('.')[0];
    const relField = relatedField.split('.')[1];
    const desc = _.get(this.describeMap, [childObject]);
    let soql = this.generateSOQL(childObject);
    const ids = [];
    _.forEach(qr.records, (record) => {
      ids.push(record.Id);
    });
    const where = '\'' +  _.join(ids, '\',\'');
    const whereClause = `${where}`;
    soql += ` WHERE ${relField} in (${where}') LIMIT 30`;
    this.ux.log(soql);
    return this.org.getConnection().query(soql);
    // .then((qrx) => {
    //  return this.stripNullsFromQueryResult(qrx);
    // });
  }*/

  private stripNullsFromQueryResult(qr) {
    _.forEach(qr.records, record => {
      _.forEach(_.keys(record), key => {
        if (_.isNull(record[key])) {
          delete record[key];
        }
      });
    });
    return qr;
  }

  private selectFilters(field) {
    return field.createable
      && _.indexOf(field.referenceTo, 'User') === -1
      && _.indexOf(field.referenceTo, 'Group');
  }

  /*private generateSOQL(objName) {
    let selectClause: string = 'Id, ';
    const fieldLimit: number = 100;
    _.forEach(this.describeMap[objName].fields, (field: Field, index: number) => {
      if (this.selectFilters(field) && index <= fieldLimit) {
        selectClause += field.name + ', ';
      }
    });
    selectClause = selectClause.substr(0, selectClause.length - 2);
    return 'SELECT ' + selectClause + ' FROM ' + objName;
  }*/

  /*private getObjectFromName(objName) {
    return objName.split('.')[0];
  }*/

  /*private isChildOfOtherObject(objName) {
    const thisMap = this.queryMap[objName];
    return _.indexOf(thisMap.children, objName);
  }*/

  // To determine if this is a root level object, we need to look at each object's
  // describe and see if it is referenced by the other objects. If it is and it's
  // not a self reference, then it is not a root object, otherwise it is.
  /*private isRootLevel(objName: string, queryMap): boolean {
    let result: boolean = true;
    _.map(queryMap.queryMap, (obj, name) => { // check each element of the queryMap
      if (name !== objName) { // Now need to see if we are a child of ourselves
        // at the query map for some object that is not the one we are checking
        _.map(obj.children, (child, childName) => { // Look for our object in this one's children
          // Need to check to see if this object is a child of any other objects
          if (child.split('.')[0] === objName) {
            result = false;
            return;
          }
        });
      } else {
        return true;
      }
    });
    return result;
  }*/

  private createQueryMap(relationshipMap) {
    let relationShips = [];
    _.map(relationshipMap, (value, key, collection) => {
      relationShips.push(value);
    });
    relationShips = _.sortBy(relationShips, o => {
      if (o.childRefs) {
        return o.childRefs.length * -1;
      } else {
        return 0;
      }
    });

    const queryMap = {};
    const objectInventory = {};
    _.forEach(relationShips, (value, index, collection) => {
      _.set(objectInventory, [value.name], index + 1);
      if (value.hasOwnProperty('childRefs')) {
        this.listOfParents.push(value.name);
      }
      _.forEach(value.childRefs, (child, ind, parents) => {
        this.listOfChildren.push(child.childSObject);
        _.set(queryMap, [value.name, 'children', ind] , child.childSObject + '.' + child.field);
        if (_.isUndefined(objectInventory[child.childSObject])) {
          _.set(objectInventory, [child.childSObject], index + ind + 1);
        }
        // this.ux.log(value.name, ' has children: ', child.childSObject);
      });
     /* _.forEach(value.parentRefs, (parent, key, parents) => {
        _.forEach(parent.referenceTo, (p, i) => {
          _.set(queryMap, [value.name, i], p);
          // this.ux.log('References: ' + p);
        });
      });*/
    });
    this.listOfChildren = _.uniq(this.listOfChildren);
    this.listOfParents = _.uniq(this.listOfParents);
    return queryMap;
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
        _.set(relationshipMap, [value, 'name'], value);
      }
    }
    /*_.map(this.describeMap, async (value: IDescribeSObjectResult, key, collection) => {
      _.forEach(value.childRelationships, (child, index) => {
        if (_.indexOf(objects, child.childSObject) !== -1) {
          _.set(relationshipMap, [key, 'childRefs', index], child);
        }
      });
      if (relationshipMap[key]) {
        _.remove(relationshipMap[key]['childRefs'], function(n) {
          return _.isUndefined(n);
        });
      }
      _.set(relationshipMap, [key, 'name'], key);
    });*/
    return relationshipMap as RelationshipMap;
  }

  private getObjectParentRelationships(objects): RelationshipMap {
    const relationshipMap = {};
    // tslint:disable-next-line:no-any
    _.map(this.describeMap, (value: any, key, collection) => {
      _.forEach(value.fields, (field, index, fields) => {
        if (field.type === 'reference') {
          // tslint:disable-next-line:prefer-for-of
          for (let i = 0; i < field.referenceTo.length; i++ ) {
            if (_.indexOf(objects, field.referenceTo[i]) !== -1) {
              _.set(relationshipMap, [key, 'parentRefs', i], field);
            }
          }
        }
      });
      if (relationshipMap[key]) {
        _.remove(relationshipMap[key]['parentRefs'], n => {
          return _.isUndefined(n);
        });
      }
      _.set(relationshipMap, [key, 'name'], key);

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
    /* Sample of the struction of the relationship map
      {
        { "Account": {
          parentRefs: [],
          childRefs: []
        }}
      }
    */
    const relationshipMap: RelationshipMap = {} as RelationshipMap;
    _.merge(relationshipMap,
            this.getObjectChildRelationships(objects),
            this.getObjectParentRelationships(objects));

    // this.ux.log('Relationship Map\n\n');
    // this.ux.logJson(relationshipMap);
    return relationshipMap;
  }
}
