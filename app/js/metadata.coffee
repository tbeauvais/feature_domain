class @AppMetadata

  tree: new TreeModel()

  root: null

  reset:  ->
    @root = null

  getDataResources:  ->
    @_getTypes 'DataResources'

  addDataResource: (resourceName, resource, id) ->
    data = {name: resourceName, resource: resource}
    @_addType('DataResources', resourceName, data, id)
    @_addSubType('DataResources', resourceName, 'Operations')

  addDataResourceReference: (resourceName, featureId) ->
    resource = @_getTypeNode('DataResources', resourceName)
    if resource
      feature = @getFeature(featureId)
      if feature
        node = @tree.parse({feature_instance_id: feature.instance.id, id: @_uniqueId(), name: feature.name})
        resource.addChild(node)

  addDataResourceOperation: (resourceName, operation) ->
    resource = @_getTypeNode('DataResources', resourceName)
    if resource
      operations = _.find resource.children, (node)->
        return node.model.name == 'Operations'

      if operations
        node = @tree.parse(operation)
        operations.addChild(node)

  getDataResourceOperations: (resourceName) ->
    resource = @_getTypeNode('DataResources', resourceName)
    if resource
      operations = _.find resource.children, (node)->
        return node.model.name == 'Operations'

      _.map operations.children, (node)->
        return node.model


  getDataResourceReferences: (resourceName) ->
    resource = @_getTypeNode('DataResources', resourceName)
    if resource
      _.map resource.children, (node)->
        return node.model
    else
      []

  addDataSchema: (name, schema, id) ->
    data = { name: name, schema: schema }
    @_addType('DataSchemas', name, data, id)

  getDataSchema: (schemaName) ->
    schema = @_getTypeNode('DataSchemas', schemaName)
    if schema
      schema.model

  getDataSchemas: ->
    @_getTypes 'DataSchemas'

  addFeatureDependency: (parentId, featureId) ->
    return if parentId == featureId || @hasFeatureDependencies(parentId, featureId)

    parentFeature = @_getTypeNodeById('Features', parentId)
    feature = @_getTypeNodeById('Features', featureId)
    if parentFeature && feature
      node = @tree.parse({feature_instance_id: feature.model.id, id: @_uniqueId(), name: feature.model.name})
      parentFeature.addChild(node)

  getFeatureDependencies: (featureId) ->
    feature =  @_getTypeNodeById('Features', featureId)
    if feature
      _.map feature.children, (node)->
        return node.model
    else
      []

  hasFeatureDependencies: (parentId, featureId) ->
    dependencies = @getFeatureDependencies(parentId)
    dep = _.find dependencies, (node)->
      return node.feature_instance_id == featureId
    if dep
      true
    else
      false

  getPageTargetFeatureInstance: (pageName, target) ->
    nodes = @_getPageTargets(pageName)
    if nodes
      #nodes.first {strategy: 'breadth'}, (node) ->
      nodes.first (node) ->
        node.model.id == target
    else
      null

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
      console.log "addPageTarget target not found #{target} for featureInstanceId #{featureInstanceId}"

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

  _getTypesNode: (type) ->
    root = @getRoot()

    resources = root.first (node) ->
      node.model.name == type

    if resources
      resources
    else
      []

  _getTypeNode: (type, name) ->
    types = @_getTypesNode(type)
    if types
      types.first (node) ->
        node.model.name && node.model.name == name
    else
      null

  _getTypeNodeById: (type, id) ->
    types = @_getTypesNode(type)
    if types
      types.first (node) ->
        node.model.id && node.model.id == id
    else
      null

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

  _addSubType: (parentType, parentName, type) ->
    parent = @_getTypeNode(parentType, parentName)

    if parent
      subType = @tree.parse({id: @_uniqueId(), name: type})
      parent.addChild(subType)

  _uniqueId: ->
    '_' + Math.random().toString(36).substr(2, 9)

angular.module('sampleDomainApp').value 'AppMetadata', new AppMetadata()