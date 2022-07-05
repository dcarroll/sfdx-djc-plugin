import * as path from 'path';
import * as fs from 'fs';
import _ = require('lodash');
import { SfdxCommand, UX } from '@salesforce/command';


export default class DataApi {

    private temparray = [];

    public async run(ux: UX, dataPlan: string, cmd: SfdxCommand): Promise<any> {
        return this.splitFiles(ux, dataPlan, cmd);
    }

    private async validateFile(path: string) {
        return fs.existsSync(path);
    };
    
    private async writeFile(name, contents) {
        var fs = require('fs');
        fs.writeFile(name, contents, function(err) {
            if(err) {
                return console.log(err);
            }
            console.log("The file was saved!\n" + name);
        }); 
    };

    private async writeDataFile(datafolder, recordData) {
        this.writeFile(path.join(datafolder, recordData.fileName), JSON.stringify(recordData.data, null, 4));
        this.temparray.push(recordData.fileName);
    };

    private splitFiles(ux: UX, dataPlan: string, cmd: SfdxCommand) {
        const filepath = path.resolve(process.cwd(), dataPlan);
        const datafolder = path.dirname(filepath);
        if (!this.validateFile(filepath)) {
            cmd.error('Error splitting files.');
        }
        let plan = require(filepath);
        const that = this;
        _.forEach(plan, function(p) {
            _.forEach(p.files, function(f) {
                that.breakupDataFile(datafolder, f);
                console.log(f);
            });
            p.files = that.temparray;
            that.writeFile(filepath, JSON.stringify(plan, null, 4));
        });
    }
    
    protected breakupDataFile(datafolder: string, f: string) {
        let records = require(path.join(datafolder, f)).records;
        if (records.length <= 200) {
            this.temparray.push(f);
            return
        }
        let i: number, j: number;
        const chunk = 200;
        this.temparray = [];
        for (i=0,j=records.length; i<j; i+=chunk) {
            const fname = path.basename(f).split('.');
            this.writeDataFile(datafolder, 
                { "data": 
                    { "records":records.slice(i,i+chunk)  }, 
                "fileName": fname[0] + i + '.' + fname[1] 
                }
            );
        }
    }
    
}

