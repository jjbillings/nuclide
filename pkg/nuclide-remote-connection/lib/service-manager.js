/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 * @format
 */

import type {NuclideUri} from 'nuclide-commons/nuclideUri';
import type {Transport} from '../../nuclide-rpc';

import {IpcClientTransport} from './IpcTransports';
import {ServerConnection} from './ServerConnection';
import nuclideUri from 'nuclide-commons/nuclideUri';
import {fork} from 'nuclide-commons/process';
import featureConfig from 'nuclide-commons-atom/feature-config';
import invariant from 'assert';
import {isGkEnabled} from '../../commons-node/passesGK';
import {track} from '../../nuclide-analytics';
import servicesConfig from '../../nuclide-server/lib/servicesConfig';
import {RpcConnection} from '../../nuclide-rpc';
import {getAtomSideLoopbackMarshalers} from '../../nuclide-marshalers-atom';

const useLocalRpc = Boolean(
  featureConfig.get('useLocalRpc') || isGkEnabled('nuclide_local_rpc'),
);
let localRpcClient: ?RpcConnection<Transport> = null;

// Creates a local RPC client that connects to a separate process.
function createLocalRpcClient(): RpcConnection<Transport> {
  // We cannot synchronously spawn the process here due to the shell environment.
  // process.js will wait for Atom's shell environment to become ready.
  const localServerProcess = fork(
    '--require',
    [
      require.resolve('../../commons-node/load-transpiler'),
      require.resolve('./LocalRpcServer'),
    ],
    {
      killTreeWhenDone: true,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'ipc'],
    },
  );
  const transport = new IpcClientTransport(localServerProcess);
  return RpcConnection.createLocal(
    transport,
    getAtomSideLoopbackMarshalers,
    servicesConfig,
  );
}

export function getlocalService(serviceName: string): Object {
  if (useLocalRpc) {
    if (localRpcClient == null) {
      localRpcClient = createLocalRpcClient();
      track('use-local-rpc');
    }
    return localRpcClient.getService(serviceName);
  } else {
    const [serviceConfig] = servicesConfig.filter(
      config => config.name === serviceName,
    );
    invariant(serviceConfig, `No config found for service ${serviceName}`);
    // $FlowIgnore
    return require(serviceConfig.implementation);
  }
}

/**
 * Create or get a cached service.
 * @param uri It could either be either a local path or a remote path in form of
 *    `nuclide://$host/$path`. The function will use the $host from remote path to
 *    create a remote service or create a local service if the uri is local path.
 */
export function getServiceByNuclideUri(
  serviceName: string,
  uri: ?NuclideUri = null,
): ?any {
  const hostname = nuclideUri.getHostnameOpt(uri);
  return getService(serviceName, hostname);
}

/**
 * Asynchronously create or get a cached service.
 * @param uri It could either be either a local path or a remote path in form of
 *    `nuclide://$host/$path`. The function will use the $host from remote path to
 *    create a remote service or create a local service if the uri is local path.
 */
export function awaitServiceByNuclideUri(
  serviceName: string,
  uri: ?NuclideUri = null,
): Promise<?any> {
  const hostname = nuclideUri.getHostnameOpt(uri);
  return awaitService(serviceName, hostname);
}

/**
 * Create or get cached service.
 * null connection implies get local service.
 */
export function getServiceByConnection(
  serviceName: string,
  connection: ?ServerConnection,
): Object {
  if (connection == null) {
    return getlocalService(serviceName);
  } else {
    return connection.getService(serviceName);
  }
}

/**
 * Create or get a cached service. If hostname is null or empty string,
 * it returns a local service, otherwise a remote service will be returned.
 */
export function getService(serviceName: string, hostname: ?string): ?Object {
  if (hostname != null && hostname !== '') {
    const serverConnection = ServerConnection.getByHostname(hostname);
    if (serverConnection == null) {
      return null;
    }
    return serverConnection.getService(serviceName);
  } else {
    return getlocalService(serviceName);
  }
}

/**
 * Asynchronously create or get a cached service. If hostname is null or empty
 * string, it returns a local service, otherwise a remote service will be returned.
 */
export function awaitService(
  serviceName: string,
  hostname: ?string,
): Promise<?Object> {
  if (hostname != null && hostname !== '') {
    return ServerConnection.connectionAddedToHost(hostname)
      .first()
      .toPromise()
      .then(serverConnection => serverConnection.getService(serviceName));
  } else {
    return Promise.resolve(getlocalService(serviceName));
  }
}
