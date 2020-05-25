import * as path from 'path';
import * as fs from 'fs';

import * as models from '../Models';
import { Logger } from '../Engine/logger';
import { ArtifactItemStore } from '../Store/artifactItemStore';

var tl = require('azure-pipelines-task-lib');

export class FilesystemProvider implements models.IArtifactProvider {

    public artifactItemStore: ArtifactItemStore;

    constructor(rootLocation: string, rootItemPath?: string) {
        this._rootLocation = rootLocation;
        this._rootItemPath = rootItemPath ? rootItemPath : '';
    }

    getRootItems(): Promise<models.ArtifactItem[]> {
        var rootItem = new models.ArtifactItem();
        rootItem.metadata = { downloadUrl: this._rootLocation };
        rootItem.path = this._rootItemPath;
        rootItem.itemType = models.ItemType.Folder;
        return Promise.resolve([rootItem]);
    }

    getArtifactItems(artifactItem: models.ArtifactItem): Promise<models.ArtifactItem[]> {
        var itemsPath = artifactItem.metadata["downloadUrl"];
        return this.getItems(itemsPath, artifactItem.path);
    }

    getArtifactItem(artifactItem: models.ArtifactItem): Promise<NodeJS.ReadableStream> {
        var promise = new Promise<NodeJS.ReadableStream>((resolve, reject) => {
            var itemPath: string = artifactItem.metadata['downloadUrl'];
            try {
                var contentStream = fs.createReadStream(itemPath);
                contentStream.on('end', () => {
                    this.artifactItemStore.updateDownloadSize(artifactItem, contentStream.bytesRead);
                });
                contentStream.on("error",
                    (error) => {
                        reject(error);
                    });
                resolve(contentStream);
            } catch (error) {
                reject(error);
            }
        });

        return promise;
    }

    public putArtifactItem(item: models.ArtifactItem, stream: NodeJS.ReadableStream): Promise<models.ArtifactItem> {
        return new Promise((resolve, reject) => {
            let outputItemPath = path.join(this._rootLocation, item.path);

            if (item.itemType === models.ItemType.File) {
                const fileName = this.getFileName(item.path);
                if (fileName) {
                    outputItemPath = path.join(this._rootLocation, fileName);
                }
                const folder = path.dirname(outputItemPath);
                try {
                    // create parent folder if it has not already been created
                    tl.mkdirP(folder);

                    Logger.logMessage(tl.loc("DownloadingTo", item.path, outputItemPath));
                    const outputStream = fs.createWriteStream(outputItemPath);
                    stream.pipe(outputStream);
                    stream.on("end",
                        () => {
                            Logger.logMessage(tl.loc("DownloadedTo", item.path, outputItemPath));
                            if (!item.metadata) {
                                item.metadata = {};
                            }

                            item.metadata[models.Constants.DestinationUrlKey] = outputItemPath;
                        });
                    stream.on("error",
                        (error) => {
                            reject(error);
                        });
                    outputStream.on("finish", () => {
                        this.artifactItemStore.updateFileSize(item, outputStream.bytesWritten);
                        resolve(item);
                    });
                }
                catch (err) {
                    reject(err);
                }
            }
            else {
                try {
                    tl.mkdirP(outputItemPath);
                    resolve(item);
                }
                catch (err) {
                    reject(err);
                }
            }
        });
    }

    dispose(): void {
    }

    private getItems(itemsPath: string, parentRelativePath?: string): Promise<models.ArtifactItem[]> {
        var promise = new Promise<models.ArtifactItem[]>((resolve, reject) => {
            var items: models.ArtifactItem[] = [];
            fs.readdir(itemsPath, (error, files) => {
                if (!!error) {
                    Logger.logMessage(tl.loc("UnableToReadDirectory", itemsPath, error));
                    reject(error);
                    return;
                }

                for (var index = 0; index < files.length; index++) {
                    var file = files[index];
                    var filePath = path.join(itemsPath, file);

                    // do not follow symbolic link
                    var itemStat;
                    try {
                        itemStat = fs.lstatSync(filePath);
                    } catch (error) {
                        reject(error);
                        return;
                    }

                    var item: models.ArtifactItem = <models.ArtifactItem>{
                        itemType: itemStat.isFile() ? models.ItemType.File : models.ItemType.Folder,
                        path: parentRelativePath ? path.join(parentRelativePath, file) : file,
                        fileLength: itemStat.size,
                        lastModified: itemStat.mtime,
                        contentType: undefined,
                        metadata: { "downloadUrl": filePath }
                    }

                    items = items.concat(item);
                }

                resolve(items);
            });
        });

        return promise;
    }

    /**
     * Get file name from full path to this file.
     * @returns {string} File name without folders
     * @param {string} path Path to file
     */
    private getFileName(path: string): string {
        let regEx: RegExp = new RegExp(/(?!\/).[^/]+$/);
        let match: RegExpExecArray = regEx.exec(path);
        return match ? match[0] : undefined;
    }

    private _rootLocation: string;
    private _rootItemPath: string;
}