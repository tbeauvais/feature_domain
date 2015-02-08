(function(){

  describe('factory: Features', function () {
    var features;

    beforeEach(module('sampleDomainApp'));

    beforeEach(function() {

      inject(function ($injector) {
        features = $injector.get('Features');
      });

    });

    it('getFeature returns the correct feature', function () {
      expect(features.getFeature('TextFeature').name).toEqual('Text');
    });

    it('createFeatureInstance returns feature instance object', function () {
     var featureInstance = {
        feature: 'TextFeature',
        id: '9',
        template: '',
        inputs: {
          name: 'untitled',
          text: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit'
        }
      };
      expect(features.createFeatureInstance('TextFeature')).toEqual(featureInstance);
    });

    it('getFeatures returns all features', function () {
      expect(features.getFeatures()).not.toEqual(null);
    });

  });


  describe('factory: AppFeatures', function () {
    var appFeatures;

    beforeEach(module('sampleDomainApp'));

    beforeEach(function() {
      inject(function ($injector) {
        appFeatures = $injector.get('AppFeatures');

        var app_features = [{id: '1', inputs: {page_location: {target: 'A', name: 'P1'}}}, {id: '2', inputs: {page_location: {target: 'B', name: 'P1'}}}];

        appFeatures.features = function() {
          return app_features
        }

        appFeatures.saveFeatures = function() {
        }

      });
    });

    it('find returns the correct feature instance', function () {
      expect(appFeatures.find('1').id).toEqual('1');
    });

    it('add inserts a new feature instance', function () {
      appFeatures.add({id: ''});
      expect(appFeatures.features().length).toEqual(3);
    });

    it('add inserts a new feature after specified targetId', function () {
      appFeatures.add({id: '', inputs: {page_location: {}}}, '1');
      expect(appFeatures.features()[1].id).toEqual('3');
    });

    it('add returns the inserted feature instance', function () {
      expect(appFeatures.add({id: ''})).toEqual({id: '3'});
    });

    it('move feature instance changes order', function () {
      appFeatures.move('2', '1');
      var ids = appFeatures.features().map(function(feature) {
        return feature.id;
      });
      expect(ids).toEqual(['2', '1']);
    });

    it('move feature instance changes page_location', function () {
      appFeatures.move('2', '1');
      expect(appFeatures.features()).toEqual([{id: '2', inputs: {page_location: {target: 'A', name: 'P1'}}}, {id: '1', inputs: {page_location: {target: 'A', name: 'P1'}}}]);
    });

    it('delete removes the specified feature instance', function () {
      appFeatures.delete('2');
      expect(appFeatures.features().length).toEqual(1);
      expect(appFeatures.find('2')).toEqual(undefined);
    });

    it('nextIndex gets the next highest index', function () {
      expect(appFeatures.nextIndex()).toEqual('3');
    });


  });


  describe('class: AppMetadata', function () {
    var appMetadata;

    beforeEach(function() {
      appMetadata = new AppMetadata();
    });

    it('reset sets root to null', function () {
      expect(appMetadata.reset()).toEqual(null);
    });

    it('getDataResources returns empty array with no resources', function () {
      expect(appMetadata.getDataResources()).toEqual([]);
    });

    it('addDataResource inserts new resources', function () {
      appMetadata.addDataResource('Sales Data', 'http://data.com');
      expect(appMetadata.getDataResources()).toEqual([{name: 'Sales Data', resource: 'http://data.com'}]);
    });

    it('getPageTargets gets the targets for the specified page', function () {
      appMetadata.addPage('Page 1', 'Page 1');
      appMetadata.addPageTarget('Page 1', '#new_target');
      var nodes = appMetadata.getPageTargets('Page 1');
      var targets = _.map(nodes, function(target){
        return target.model.name;
      });
      expect(targets).toEqual(['#new_target']);
    });

    it('getPages returns empty array with no pages', function () {
      expect(appMetadata.getPages()).toEqual([]);
    });

    it('getPages gets all the pages', function () {
      appMetadata.addPage('Page 1', 'Page 1');
      expect(appMetadata.getPages()).toEqual([{id: 'Page 1', name: 'Page 1'}]);
    });

    it('addPageTarget adds the targets to the specified page', function () {
      appMetadata.addPage('Page 1', 'Page 1');
      appMetadata.addPageTarget('Page 1', '#new_target');
      var nodes = appMetadata.getPageTargets('Page 1');
      var targets = _.map(nodes, function(target){
        return target.model.name;
      });

      expect(targets).toEqual(['#new_target']);
    });

    it('getFeatures returns empty array with no features', function () {
      expect(appMetadata.getFeatures()).toEqual([]);
    });

    it('addFeature adds a feature', function () {
      appMetadata.addPage('Page 1', 'Page 1');
      appMetadata.addPageTarget('Page 1', '#content_section');
      var instance = {id: '1', feature: 'TextFeature', inputs: {name: 'My Text', page_location: {name: 'Page 1', target: '#content_section'}}};
      var feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);

      expect(appMetadata.getFeatures().length).toEqual(1);
    });

    it('getFeature finds feature by id', function () {
      appMetadata.addPage('Page 1', 'Page 1');
      appMetadata.addPageTarget('Page 1', '#content_section');
      var instance = {id: '1', feature: 'TextFeature', inputs: {name: 'My Text', page_location: {name: 'Page 1', target: '#content_section'}}};
      var feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);
      expect(appMetadata.getFeature('1').id).toEqual('1');
    });

    it('getPageNode finds node on page by id', function () {
      appMetadata.addPage('Page 1', 'Page 1');
      appMetadata.addPageTarget('Page 1', '#content_section');
      var instance = {id: '1', feature: 'TextFeature', inputs: {name: 'My Text', page_location: {name: 'Page 1', target: '#content_section'}}};
      var feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);
      appMetadata.addPageTarget(feature.page_info.page, '#' + feature.page_info.id, feature.page_info.target, feature.id);
      expect(appMetadata.getPageNode('Page 1', '1').model.feature_instance_id).toEqual('1');
    });

    it('isChildOfOnPage returns true if id is already a child', function () {
      appMetadata.addPage('Page 1', 'Page 1');
      appMetadata.addPageTarget('Page 1', '#content_section');
      var instance = {id: '1', feature: 'TextFeature', inputs: {name: 'My Text', page_location: {name: 'Page 1', target: '#content_section'}}};
      var feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);
      appMetadata.addPageTarget(feature.page_info.page, '#' + feature.page_info.id, feature.page_info.target, feature.id);

      instance = {id: '2', feature: 'TextFeature', inputs: {name: 'My Text 2', page_location: {name: 'Page 1', target: '#new_location'}}};
      feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location_2', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);
      appMetadata.addPageTarget(feature.page_info.page, '#' + feature.page_info.id, feature.page_info.target, feature.id);

      expect(appMetadata.isChildOfOnPage('2', '1')).toEqual(true);
    });

    it('isChildOfOnPage returns false if id is not already a child', function () {
      appMetadata.addPage('Page 1', 'Page 1');
      appMetadata.addPageTarget('Page 1', '#content_section');
      var instance = {id: '1', feature: 'TextFeature', inputs: {name: 'My Text', page_location: {name: 'Page 1', target: '#content_section'}}};
      var feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);
      appMetadata.addPageTarget(feature.page_info.page, '#' + feature.page_info.id, feature.page_info.target, feature.id)

      instance = {id: '2', feature: 'TextFeature', inputs: {name: 'My Text 2', page_location: {name: 'Page 1', target: '#content_section'}}};
      feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location_2', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);
      appMetadata.addPageTarget(feature.page_info.page, '#' + feature.page_info.id, feature.page_info.target, feature.id)

      expect(appMetadata.isChildOfOnPage('2', '1')).toEqual(false);
    });

  });

})();
