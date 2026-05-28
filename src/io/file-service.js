const fs = require('fs');
const path = require('path');

class FileService {
  readBinary(filePath) {
    return fs.readFileSync(filePath);
  }

  writeText(filePath, content) {
    this.#ensureDirectory(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf8');
  }

  exists(filePath) {
    return fs.existsSync(filePath);
  }

  #ensureDirectory(dirPath) {
    if (!dirPath || dirPath === '.') {
      return;
    }

    fs.mkdirSync(dirPath, { recursive: true });
  }
}

module.exports = {
  FileService,
};
