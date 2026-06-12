window.P_TFBookStore = import('/static/js/book-store.js').then(BookStore => window.TFBookStore = BookStore);
window.P_TFSigning = import('/static/js/signing.js').then(Signing => window.TFSigning = Signing);
window.P_TFBlobManager = import('/static/js/blob-manager.js').then(({ default: BlobManager }) => window.TFBlobManager = BlobManager);