import Adapter, {
  REQUEST_CREATE,
  REQUEST_UPDATE,
  DATACENTER_QUERY_PARAM as API_DATACENTER_KEY,
} from './application';

import { PRIMARY_KEY, SLUG_KEY } from 'consul-ui/models/token';
import { FOREIGN_KEY as DATACENTER_KEY } from 'consul-ui/models/dc';
import { OK as HTTP_OK } from 'consul-ui/utils/http/status';
import { PUT as HTTP_PUT } from 'consul-ui/utils/http/method';

import { get } from '@ember/object';

const REQUEST_CLONE = 'cloneRecord';
const REQUEST_SELF = 'querySelf';

const uniqueName = function(haystack, needle) {
  return `Duplicate of ${needle}`;
};
export default Adapter.extend({
  cleanQuery: function(_query) {
    const query = this._super(...arguments);
    // TODO: Make sure policy is being passed through
    delete _query.policy;
    //take off the token for /self
    delete query.token;
    return query;
  },
  urlForQuery: function(query, modelName) {
    return this.appendURL('acl/tokens', [], this.cleanQuery(query));
  },
  urlForQueryRecord: function(query, modelName) {
    if (typeof query.id === 'undefined') {
      throw new Error('You must specify an id');
    }
    return this.appendURL('acl/token', [query.id], this.cleanQuery(query));
  },
  urlForQuerySelf: function(query, modelName) {
    return this.appendURL('acl/token/self', [], this.cleanQuery(query));
  },
  urlForCreateRecord: function(modelName, snapshot) {
    return this.appendURL('acl/token', [], {
      [API_DATACENTER_KEY]: snapshot.attr(DATACENTER_KEY),
    });
  },
  urlForUpdateRecord: function(id, modelName, snapshot) {
    return this.appendURL('acl/token', [snapshot.attr(SLUG_KEY)], {
      [API_DATACENTER_KEY]: snapshot.attr(DATACENTER_KEY),
    });
  },
  urlForDeleteRecord: function(id, modelName, snapshot) {
    return this.appendURL('acl/token', [snapshot.attr(SLUG_KEY)], {
      [API_DATACENTER_KEY]: snapshot.attr(DATACENTER_KEY),
    });
  },
  urlForRequest: function({ type, snapshot, requestType }) {
    switch (requestType) {
      case 'cloneRecord':
        return this.urlForCloneRecord(type.modelName, snapshot);
      case 'querySelf':
        return this.urlForQuerySelf(snapshot, type.modelName);
    }
    return this._super(...arguments);
  },
  urlForCloneRecord: function(modelName, snapshot) {
    return this.appendURL('acl/token', [snapshot.attr(SLUG_KEY), 'clone'], {
      [API_DATACENTER_KEY]: snapshot.attr(DATACENTER_KEY),
    });
  },
  isCloneRecord: function(url, method) {
    const last = url.pathname.split('/').pop();
    return last === 'clone';
  },
  isQuerySelf: function(url, method) {
    return url.pathname === this.urlForQuerySelf({});
  },
  self: function(store, modelClass, snapshot) {
    const params = {
      store: store,
      type: modelClass,
      snapshot: snapshot,
      requestType: 'querySelf',
    };
    // _requestFor is private... but these methods aren't, until they disappear..
    const request = {
      method: this.methodForRequest(params),
      url: this.urlForRequest(params),
      headers: this.headersForRequest(params),
      data: this.dataForRequest(params),
    };
    // TODO: private..
    return this._makeRequest(request);
  },
  clone: function(store, modelClass, id, snapshot) {
    const params = {
      store: store,
      type: modelClass,
      id: id,
      snapshot: snapshot,
      requestType: 'cloneRecord',
    };
    // _requestFor is private... but these methods aren't, until they disappear..
    const request = {
      method: this.methodForRequest(params),
      url: this.urlForRequest(params),
      headers: this.headersForRequest(params),
      data: this.dataForRequest(params),
    };
    // TODO: private..
    return this._makeRequest(request);
  },
  handleSingleResponse: function(url, response, primary, slug) {
    // Sometimes we get `Policies: null`, make null equal an empty array
    if (response.Policies === null) {
      response.Policies = [];
    }
    return this._super(url, response, primary, slug);
  },
  handleResponse: function(status, headers, payload, requestData) {
    let response = payload;
    const method = requestData.method;
    if (status === HTTP_OK) {
      const url = this.parseURL(requestData.url);
      switch (true) {
        case response === true:
          response = this.handleBooleanResponse(url, response, PRIMARY_KEY, SLUG_KEY);
          break;
        case this.isQuerySelf(url, method):
        case this.isCloneRecord(url, method):
        case this.isQueryRecord(url, method):
          response = this.handleSingleResponse(url, response, PRIMARY_KEY, SLUG_KEY);
          break;
        default:
          response = this.handleBatchResponse(url, response, PRIMARY_KEY, SLUG_KEY);
      }
    }
    return this._super(status, headers, response, requestData);
  },
  methodForRequest: function(params) {
    switch (params.requestType) {
      case REQUEST_CLONE:
        return HTTP_PUT;
    }
    return this._super(...arguments);
  },
  headersForRequest: function(params) {
    switch (params.requestType) {
      case REQUEST_SELF:
        return {
          'X-Consul-Token': params.token,
        };
    }
    return this._super(...arguments);
  },
  dataForRequest: function(params) {
    let data = this._super(...arguments);
    switch (params.requestType) {
      case REQUEST_UPDATE:
      case REQUEST_CREATE:
        data.token.Policies = data.token.Policies.filter(function(item) {
          // Just incase, don't save any policies that aren't saved
          return !get(item, 'isNew');
        }).map(function(item) {
          return {
            ID: get(item, 'ID'),
            Name: get(item, 'Name'),
          };
        });
        data = data.token;
        break;
      case REQUEST_SELF:
        return {};
      case REQUEST_CLONE:
        data = {};
        params.store
          .serializerFor(params.type.modelName)
          .serializeIntoHash(data, params.type, params.snapshot);
        // Usually we never save the AccessorID, so it is removed in the
        // Model (via Serializer.attrs).
        // Cloning needs the AccessorID to be able to clone, so as this
        // is essentially a single special case, add the AccessorID back in
        // here after its been removed
        data.token[SLUG_KEY] = params.snapshot.attr(SLUG_KEY);
        data.token.Name = uniqueName(
          params.store.peekAll('token').toArray(),
          params.snapshot.attr('Name')
        );
        break;
    }
    return data;
  },
});
