import { Project } from '@salesforce/core';
import * as fs from 'fs';
import * as path from 'path';

export async function getProjectSObjectList(proj: Project) {
        const projSourceRoot: string = await getDefaultPackageDirectory(proj);
        const objectsDir: string = path.join(projSourceRoot, 'main', 'default', 'objects');
        const objects: string[] = [] as string[];
        if (fs.existsSync(objectsDir)) {
            const dirs: string[] = fs.readdirSync(objectsDir);
            dirs.forEach(element => {
                objects.push(path.basename(element));
            });
            return objects;
        } else {
            return [] as string[];
        }
    }

async function getDefaultPackageDirectory(proj: Project): Promise<string> {
    const projJson = await proj.resolveProjectConfig();
    // tslint:disable-next-line:prefer-for-of
    for (let index = 0; index < projJson['packageDirectories'].length; index++) {
        const element = projJson['packageDirectories'][index];
        if (element.default === true) {
            return element.path;
        }
    }
}
