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
          text: '',
          page_location: {
            name: 'Page 1',
            target: '#page_container'
          }
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
      appFeatures.add({id: ''}, '1');
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


  describe('factory: AppMetadata', function () {
    var appMetadata;

    beforeEach(module('sampleDomainApp'));

    beforeEach(function() {
      inject(function ($injector) {
        appMetadata = $injector.get('AppMetadata');

      });
    });

    it('reset sets root to null', function () {
      expect(appMetadata.reset()).toEqual(null);
    });

    it('getPageTargets gets the targets for the specified page', function () {
      var nodes = appMetadata.getPageTargets('Page 1');
      var targets = _.map(nodes, function(target){
        return target.model.name;
      });
      expect(targets).toEqual(['#content_section']);
    });

    it('getPages gets all the pages', function () {
      expect(appMetadata.getPages()).toEqual(['Page 1']);
    });

    it('addPageTarget adds the targets to the specified page', function () {
      appMetadata.addPageTarget('Page 1', '#new_target');
      var nodes = appMetadata.getPageTargets('Page 1');
      var targets = _.map(nodes, function(target){
        return target.model.name;
      });

      expect(targets).toEqual(['#content_section','#new_target']);
    });

    it('getFeatures gets all the features', function () {
      expect(appMetadata.getFeatures().children).toEqual([]);
    });

    it('addFeature adds a feature', function () {
      var instance = {id: '1', feature: 'TextFeature', inputs: {name: 'My Text', page_location: {name: 'Page 1', target: '#content_section'}}};
      var feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};

      expect(appMetadata.addFeature(feature).model.id).toEqual('1');
    });

    it('getFeature finds feature by id', function () {
      var instance = {id: '1', feature: 'TextFeature', inputs: {name: 'My Text', page_location: {name: 'Page 1', target: '#content_section'}}};
      var feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);
      expect(appMetadata.getFeature('1').model.id).toEqual('1');
    });

    it('getPageNode finds node on page by id', function () {
      var instance = {id: '1', feature: 'TextFeature', inputs: {name: 'My Text', page_location: {name: 'Page 1', target: '#content_section'}}};
      var feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);
      expect(appMetadata.getPageNode('Page 1', '1').model.feature_instance_id).toEqual('1');
    });

    it('isChildOfOnPage returns true if id is already a child', function () {
      var instance = {id: '1', feature: 'TextFeature', inputs: {name: 'My Text', page_location: {name: 'Page 1', target: '#content_section'}}};
      var feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);

      var instance = {id: '2', feature: 'TextFeature', inputs: {name: 'My Text 2', page_location: {name: 'Page 1', target: '#new_location'}}};
      var feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location_2', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);


      expect(appMetadata.isChildOfOnPage('2', '1')).toEqual(true);
    });

    it('isChildOfOnPage returns false if id is not already a child', function () {
      var instance = {id: '1', feature: 'TextFeature', inputs: {name: 'My Text', page_location: {name: 'Page 1', target: '#content_section'}}};
      var feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);

      var instance = {id: '2', feature: 'TextFeature', inputs: {name: 'My Text 2', page_location: {name: 'Page 1', target: '#content_section'}}};
      var feature = {id: instance.id, instance: instance, name: instance.inputs.name, page_info: {id: 'new_location_2', page: instance.inputs.page_location.name, target: instance.inputs.page_location.target}};
      appMetadata.addFeature(feature);

      expect(appMetadata.isChildOfOnPage('2', '1')).toEqual(false);
    });


  });


})();
