class @AppMetadata

  tree: new TreeModel()

  root: null

  reset:  ->
    @root = null

  getDataResources:  ->
    @_getTypes 'DataResources'

  addDataResource: (name, resource, id) ->
    data = {name: name, resource: resource}
    @_addType('DataResources', name, data, id)

  getPageTargets: (pageName) ->
    targets = @_getPageTargets(pageName)

    newTargets = []
    @_addTargets(targets.children, newTargets)
    newTargets

  getPages:  ->
    @_getTypes 'Pages'

  addPage: (id, name) ->
    data = {id: id, name: name}
    @_addType 'Pages', name, data

  getFeatures:  ->
    @_getTypes 'Features'

  addFeature: (feature, featureInstanceId)  ->
    @_addType('Features', name, feature, featureInstanceId)

  getFeature: (id)  ->
    features = @getFeatures()

    if features
      _.find features, (feature) ->
        feature.id == id
    else
      null

  addPageTarget: (pageName, target, parent, featureInstanceId) ->
    targets = @_getPageTargets(pageName)

    unless targets
      page = @_getPage(pageName)
      targets = @tree.parse({id: 'Targets', name: 'Targets'})
      page.addChild(targets)

    if parent
      targets = targets.first (node) ->
        node.model.name == parent

    node = @tree.parse({feature_instance_id: featureInstanceId, id: target, name: target})
    if targets
      targets.addChild(node)
    else
      debugger

  getPageNode: (pageName, id) ->
    page = @_getPage(pageName)
    page.first (node) ->
      node.model.feature_instance_id && node.model.feature_instance_id == id

  isChildOfOnPage: (childId, parentId) ->
    feature = @getFeature(childId)
    child = @getPageNode(feature.page_info.page, childId)
    match = _.find child.getPath(), (node) ->
      return node.model.feature_instance_id == parentId
    !_.isUndefined(match)

  getRoot: ->
    if @root == null
      @root = @tree.parse(id: 'Application', name: 'Application')

    @root

  _getPageTargets: (pageName) ->
    page = @_getPage(pageName)

    if page
      page.first (node) ->
        node.model.name == 'Targets'

  _getPage: (pageName) ->
    root = @getRoot()

    page = root.first (node) ->
      node.model.name == pageName

  _addTargets: (children, targets) ->
    _.each children, (node) =>
      if node.hasChildren()
        @_addTargets(node.children, targets)
      targets.push(node)

  _getTypes: (type) ->
    root = @getRoot()

    resources = root.first (node) ->
      node.model.name == type

    if resources
      _.map resources.children, (node)->
        return node.model
    else
      []

  _addType: (type, name, data, featureInstanceId) ->
    root = @getRoot()
    resources = root.first (node) ->
      node.model.name == type

    unless resources
      resources = @tree.parse({id: type, name: type})
      root.addChild(resources)

    if featureInstanceId
      data.feature_instance_id = featureInstanceId
    node = @tree.parse(data)
    resources.addChild(node)
    resources

angular.module('sampleDomainApp').value 'AppMetadata', new AppMetadata()