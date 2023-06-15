import { expect, test } from '@salesforce/command/dist/test';

describe('djc:data:export', () => {
  test
    .withOrg({ username: 'test@org.com' }, true)
    .withConnectionRequest(request => {
      if (request.url.match(/Organization/)) {
        return Promise.resolve({ records: [ { Name: 'Super Awesome Org', TrialExpirationDate: '2018-03-20T23:24:11.000+0000'}] });
      }
      return Promise.resolve({ records: [] });
    })
    .stdout()
    .command(['djc:data:export', '--targetusername', 'test@org.com'])
    .it('runs djc:data:export --targetusername test@org.com', ctx => {
      expect(ctx.stdout).to.contain('Hello world! This is org: Super Awesome Org and I will be around until Tue Mar 20 2018!');
    });
});
