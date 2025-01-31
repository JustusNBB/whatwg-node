module.exports = function addFormDataToRequest(Request, File, FormData) {
  const existingFormDataMethod = Request.prototype.formData;
  Request.prototype.formData = async function formData(...args) {
    try {
      const existingResult = await existingFormDataMethod.apply(this, args);
      if (!existingResult) {
        throw new Error('Existing formData method returned undefined');
      }
    } catch(e) {
      const parseMultipartData = require('./multipart');
      const contentType = this.headers.get('Content-Type');
      
      if (/multipart\/form-data/.test(contentType)) {
        const formData = new FormData();
        const boundary = parseMultipartData.getBoundary(contentType);

        if (this.body) {
          const arrayBuffer = await this.arrayBuffer();
          const allParts = parseMultipartData.parse(Buffer.from(arrayBuffer), boundary);
          for (const part of allParts) {
            if (part.type) {
              if (File) {
                const file = new File([part.data], part.filename, { type: part.type });
                formData.append(part.name, file);
              } else {
                formData.append(part.name, part.data, part.filename);
              }
            } else {
              formData.append(part.name, part.data.toString('utf8'));
            }
          }
          return formData
        }
      }
    }
  }
}