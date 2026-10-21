// Runs once before all tests: creates the fixture files (tests fail loudly if this did not work).
const path = require('path');
const { writeFixtures } = require('./make-media-fixture');

module.exports = async () => {
  writeFixtures(path.resolve(__dirname, '..', 'fixtures'));
};
